const fs = require('fs');
const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const fetchRevisions = async (articleUrl) => {
    const pageTitle = articleUrl.split('/').pop();
    const endpoint = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=revisions&titles=${pageTitle}&rvlimit=max&rvprop=ids|timestamp`;
    try {
        const response = await axios.get(endpoint);
        const pages = response.data.query.pages;
        const pageId = Object.keys(pages)[0];
        const revisions = pages[pageId].revisions;
        return revisions.map((revision, index) => {
            const revisionUrl = `https://en.wikipedia.org/w/index.php?title=${pageTitle}&oldid=${revision.revid}`;
            const prevRevisionId = revisions[index + 1] ? revisions[index + 1].revid : null;
            const diffUrl = prevRevisionId ? `https://en.wikipedia.org/w/index.php?title=${pageTitle}&type=revision&diff=${revision.revid}&oldid=${prevRevisionId}` : '';
            return {
                revisionUrl,
                articleUrl,
                diffUrl
            };
        });
    } catch (error) {
        console.error(`Failed to fetch revisions for ${articleUrl}: ${error}`);
        return [];
    }
};


// Function to fetch metadata for a single article
const fetchArticleMetadata = async (title) => {
    const endpoint = `https://en.wikipedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent(title)}&prop=info&inprop=url|length`;
    try {
        const response = await axios.get(endpoint);
        const page = response.data.query.pages;
        const pageId = Object.keys(page)[0];
        return {
            title: page[pageId].title,
            url: page[pageId].fullurl,
            length: page[pageId].length
        };
    } catch (error) {
        console.error(`Failed to fetch article metadata: ${error}`);
        return null;
    }
};

// Function to fetch n substantial random Wikipedia articles
const fetchSubstantialRandomArticles = async (n, minLength = 20000) => {
    let substantialArticles = [];
    while (substantialArticles.length < n) {
        const endpoint = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit=10`; // Requesting batches of 10 random articles
        try {
            const response = await axios.get(endpoint);
            const randomArticles = response.data.query.random;
            for (const article of randomArticles) {
                if (substantialArticles.length >= n) break; // Stop if we have enough substantial articles
                const metadata = await fetchArticleMetadata(article.title);
                if (metadata && metadata.length >= minLength) {
                    substantialArticles.push(metadata);
                }
            }
        } catch (error) {
            console.error(`Failed to fetch random articles: ${error}`);
            break; // Exit the loop in case of an error
        }
    }
    return substantialArticles;
};

const argv = yargs(hideBin(process.argv))
    .command('revisions', 'Fetch revisions for Wikipedia articles', (yargs) => {
        return yargs
            .option('articleUrls', {
                alias: 'a',
                describe: 'Path to the file containing Wikipedia article URLs',
                default: 'data/article_urls.txt'
            })
            .option('output', {
                alias: 'o',
                describe: 'Path to the output CSV file',
                default: 'data/revisions.csv'
            });
    }, async (argv) => {
        const articleUrls = fs.readFileSync(argv.articleUrls, 'utf8').split('\n').filter(Boolean);
        let csvContent = 'revisionUrl,articleUrl,diffUrl,linkHtml\n';

        for (const articleUrl of articleUrls) {
            const revisions = await fetchRevisions(articleUrl);
            revisions.forEach(({ revisionUrl, articleUrl, diffUrl }) => {
                csvContent += `"${revisionUrl}","${articleUrl}","${diffUrl}","<a href='${diffUrl}' target='_blank'>${diffUrl}</a>"\n`;
            });
        }

        fs.writeFileSync(argv.output, csvContent);
        console.log(`Revisions have been written to ${argv.output}`);
    })
    .command('random', 'Fetch random Wikipedia articles', (yargs) => {
        return yargs
            .option('n', {
                alias: 'number',
                describe: 'Number of random Wikipedia articles to fetch',
                demandOption: true,
                type: 'number'
            })
            .option('output', {
                alias: 'o',
                describe: 'Path to the output file',
                default: 'data/random_articles.txt'
            });
    }, async (argv) => {
        const articles = await fetchSubstantialRandomArticles(argv.n);
        let outputFileContent = articles.map(article => `${article.url}`).join('\n');

        fs.writeFileSync(argv.output, outputFileContent);
        console.log(`Random Wikipedia articles have been written to ${argv.output}`);
    })
    .demandCommand(1, 'You need at least one command before moving on')
    .help()
    .argv;
