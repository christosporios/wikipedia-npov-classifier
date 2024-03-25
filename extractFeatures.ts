import fetch from 'node-fetch';

export type Revision = {
    revisionUrl: string;
    articleUrl: string;
    userName: string;
    userId: number;
    timestamp: number; // unix timestamp of the revision time
    diff: string | null;
}

const rateLimitExceededWaitTimeSeconds = 10; // 30 seconds
const getDiffs = false;

const cache: Map<string, any> = new Map();
async function fetchWithRetry(url: string, retryCount = 3): Promise<any> {
    if (cache.has(url)) {
        console.log(`Cache hit!`);
        return cache.get(url);
    }

    let response;
    let data;
    try {
        response = await fetch(url);
        data = await response.json();
    } catch (error) {
        if (response && response.status === 429) {
            if (retryCount === 0) {
                throw new Error('Rate limit exceeded. Maximum retries reached.');
            }
            console.log(`Rate limit exceeded. Waiting for ${rateLimitExceededWaitTimeSeconds} seconds...`);
            await new Promise(resolve => setTimeout(resolve, rateLimitExceededWaitTimeSeconds * 1000));
            return fetchWithRetry(url, retryCount - 1);
        } else {
            console.error(`Failed to fetch data from ${url}: ${error}`);
            console.log('response:', response);
            console.log('data:', data);
            throw error;
        }
    }

    cache.set(url, data);
    return data;
}

async function fetchRevertRiskScore(revisionId: number, retryCount = 3): Promise<number> {
    const apiUrl = 'https://api.wikimedia.org/service/lw/inference/v1/models/revertrisk-language-agnostic:predict';
    const payload = {
        rev_id: revisionId,
        lang: 'en',
    };

    let response;
    let data;

    while (retryCount > 0) {
        try {
            response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            if (response.status === 429) {
                console.log(`Rate limit exceeded. Waiting for ${rateLimitExceededWaitTimeSeconds} seconds...`);
                await new Promise(resolve => setTimeout(resolve, rateLimitExceededWaitTimeSeconds * 1000));
                retryCount--;
                continue;
            }

            data = await response.json();
            return data.output.probabilities.true;
        } catch (error) {
            console.error('Error fetching revert risk score:', error);
            retryCount--;
        }
    }

    console.error('Failed to fetch revert risk score after maximum retries.');
    return 0;
}

async function fetchPastRevisions(revisionUrl: string, rvstartid?: number): Promise<Revision[]> {
    const articleUrl = new URL(revisionUrl);
    const title = articleUrl.searchParams.get('title');

    if (!title) {
        throw new Error('Invalid revision URL: missing title parameter');
    }

    const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=ids|timestamp|user|userid&rvlimit=max&format=json&titles=${encodeURIComponent(title)}${rvstartid ? `&rvstartid=${rvstartid}` : ''}`;
    console.log('Fetching past revisions from:', apiUrl);
    const data = await fetchWithRetry(apiUrl);

    if (!data.query || !data.query.pages) {
        throw new Error(`Unexpected API response structure for ${title}`);
    }

    const page = data.query.pages[Object.keys(data.query.pages)[0]];
    const revisions: Revision[] = [];
    for (const revision of page.revisions) {
        revisions.push({
            revisionUrl: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&oldid=${revision.revid}`,
            articleUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
            userName: revision.user,
            userId: revision.userid,
            timestamp: new Date(revision.timestamp).getTime() / 1000, // convert to unix timestamp
            diff: getDiffs ? await fetchDiffFromRevId(revision.revid) : null
        });
    };

    if (data.continue && data.continue.rvcontinue) {
        const rvstartidStr = data.continue.rvcontinue.split('|')[1];
        const rvstartidInt = parseInt(rvstartidStr, 10);
        const nextRevisions = await fetchPastRevisions(revisionUrl, rvstartidInt);
        revisions.push(...nextRevisions);
    }

    revisions.reverse(); // reverse the order to have the current revision at index 0

    if (!getDiffs) { // if we didn't get diffs, make an exception for the latest 
        revisions[0].diff = await fetchDiffFromUrl(revisionUrl);
    }

    return revisions;
}

async function fetchDiffFromUrl(revisionUrl: string): Promise<string> {
    const articleUrl = new URL(revisionUrl);
    const title = articleUrl.searchParams.get('title');
    const oldid = articleUrl.searchParams.get('oldid');

    if (!title || !oldid) {
        throw new Error('Invalid revision URL: missing title or oldid parameter');
    }

    return fetchDiffFromRevId(oldid);
}

async function fetchDiffFromRevId(revisionId: string): Promise<string> {
    const apiUrl = `https://en.wikipedia.org/w/api.php?action=compare&fromrev=${revisionId}&torelative=prev&format=json&prop=diff&difftype=unified`;
    console.log('Fetching diff from:', apiUrl)

    const data = await fetchWithRetry(apiUrl);

    if (!data.compare || !data.compare) {
        throw new Error(`Unexpected API response structure for diff request for ${revisionId}`);
    }

    const diffText = data.compare['*'];
    // Check there's exactly a single <pre> block
    if ((diffText.match(/<pre>/g) || []).length !== 1) {
        console.log('diffText:', diffText);
        throw new Error('Unexpected diff format');
    }

    // Get the unified diff inside the <pre> block
    const unifiedDiff = diffText.match(/<pre>([\s\S]*?)<\/pre>/)![1];

    return unifiedDiff;
}

function calculateAverageTimeBetweenRevisions(revisions: Revision[]): number {
    if (revisions.length < 2) {
        return 0;
    }

    return revisions.reduce((acc, revision, index) => {
        if (index === 0) {
            return acc;
        }
        const timeBetweenRevisions = revision.timestamp - revisions[index - 1].timestamp;
        return acc + timeBetweenRevisions;
    }, 0) / revisions.length;
}

// Extracts average, median, standard deviation, 25th and 75th percentiles of the distribution of numbers
export function extractDistributionStatistics(baseFeatureName: string, nums: number[]): object {
    const average = nums.reduce((acc, num) => acc + num, 0) / nums.length;
    const sortedNums = nums.sort((a, b) => a - b);
    const median = sortedNums[Math.floor(sortedNums.length / 2)];
    const q1 = sortedNums[Math.floor(sortedNums.length / 4)];
    const q3 = sortedNums[Math.floor(sortedNums.length * 3 / 4)];
    const stdDev = Math.sqrt(nums.reduce((acc, num) => acc + Math.pow(num - average, 2), 0) / nums.length);
    const stats = {
        [`${baseFeatureName}Average`]: average,
        [`${baseFeatureName}Median`]: median,
        [`${baseFeatureName}Q1`]: q1,
        [`${baseFeatureName}Q3`]: q3,
        [`${baseFeatureName}StdDev`]: stdDev
    };
    console.log(`Distribution statistics for ${baseFeatureName}:`, stats);
    return stats;
}

function differences(nums: number[]): number[] {
    return nums.slice(1).map((num, ind) => num - nums[ind]);
}

export async function extractFeatures(revisionUrl: string): Promise<Record<string, any>> {
    console.log(`Extracting features for revision URL: ${revisionUrl}`);

    const pastRevisions = await fetchPastRevisions(revisionUrl);
    const thisRevision = pastRevisions[0];

    const pastRevisionsCount = pastRevisions.length;
    const timesBetweenRevisions = differences(pastRevisions.map(revision => revision.timestamp)).reverse();
    const timesBetweenUserRevisions = differences(pastRevisions.filter(revision => revision.userId === thisRevision.userId).map(revision => revision.timestamp)).reverse();

    const timesBetweenRevisionsStats = extractDistributionStatistics('timeBetweenRevisions', timesBetweenRevisions);
    const timesBetweenUserRevisionsStats = extractDistributionStatistics('timeBetweenUserRevisions', timesBetweenUserRevisions);


    const averageTimeBetweenRevisions = calculateAverageTimeBetweenRevisions(pastRevisions);
    const pastRevisionsAuthoredByUser = pastRevisions.filter(revision => revision.userId === thisRevision.userId).length;
    const averageTimeBetweenUserAuthoredRevisions = calculateAverageTimeBetweenRevisions(pastRevisions.filter(revision => revision.userId === thisRevision.userId));
    const revertRiskModelScore = await fetchRevertRiskScore(thisRevision.userId);
    const percPastRevisionsAuthored = pastRevisionsAuthoredByUser / pastRevisionsCount;
    const diffText = thisRevision.diff;

    const features = {
        authorUserName: thisRevision.userName,
        pastRevisionsCount,
        averageTimeBetweenRevisions,
        pastRevisionsAuthoredByUser,
        revertRiskModelScore,
        percPastRevisionsAuthored,
        averageTimeBetweenUserAuthoredRevisions,
        diffText,
        ...timesBetweenRevisionsStats,
        ...timesBetweenUserRevisionsStats
    };
    console.log('Features:', features);
    return features;
}
