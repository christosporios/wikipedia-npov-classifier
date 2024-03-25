import fs from 'fs';
import axios from 'axios';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { extractFeatures } from './extractFeatures';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import { readFile, writeFile } from 'fs/promises';
import { train, evaluate } from './train';

interface Revision {
    revisionUrl: string;
    articleUrl: string;
    diffUrl: string;
}

interface ArticleMetadata {
    title: string;
    url: string;
    length: number;
}

const fetchRevisions = async (articleUrl: string): Promise<Revision[]> => {
    const pageTitle = articleUrl.split('/').pop()!;
    const endpoint = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=revisions&titles=${pageTitle}&rvlimit=max&rvprop=ids|timestamp`;
    try {
        const response = await axios.get(endpoint);
        const pages = response.data.query.pages;
        const pageId = Object.keys(pages)[0];
        const revisions = pages[pageId].revisions;
        return revisions.map((revision: any, index: number) => {
            const revisionUrl = `https://en.wikipedia.org/w/index.php?title=${pageTitle}&oldid=${revision.revid}`;
            const prevRevisionId = revisions[index + 1] ? revisions[index + 1].revid : null;
            const diffUrl = prevRevisionId ? `https://en.wikipedia.org/w/index.php?title=${pageTitle}&type=revision&diff=${revision.revid}&oldid=${prevRevisionId}` : '';
            return {
                revisionUrl,
                articleUrl,
                diffUrl,
            };
        });
    } catch (error) {
        console.error(`Failed to fetch revisions for ${articleUrl}: ${error}`);
        return [];
    }
};

const fetchArticleMetadata = async (title: string): Promise<ArticleMetadata | null> => {
    const endpoint = `https://en.wikipedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent(title)}&prop=info&inprop=url|length`;
    try {
        const response = await axios.get(endpoint);
        const page = response.data.query.pages;
        const pageId = Object.keys(page)[0];
        return {
            title: page[pageId].title,
            url: page[pageId].fullurl,
            length: page[pageId].length,
        };
    } catch (error) {
        console.error(`Failed to fetch article metadata: ${error}`);
        return null;
    }
};

const fetchSubstantialRandomArticles = async (n: number, minLength: number = 20000): Promise<ArticleMetadata[]> => {
    let substantialArticles: ArticleMetadata[] = [];
    while (substantialArticles.length < n) {
        const endpoint = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit=10`;
        try {
            const response = await axios.get(endpoint);
            const randomArticles = response.data.query.random;
            for (const article of randomArticles) {
                if (substantialArticles.length >= n) break;
                const metadata = await fetchArticleMetadata(article.title);
                if (metadata && metadata.length >= minLength) {
                    substantialArticles.push(metadata);
                }
            }
        } catch (error) {
            console.error(`Failed to fetch random articles: ${error}`);
            break;
        }
    }
    return substantialArticles;
};

const argv = yargs(hideBin(process.argv))
    .command(
        'revisions',
        'Fetch revisions for Wikipedia articles',
        (yargs) => {
            return yargs
                .option('articleUrls', {
                    alias: 'a',
                    describe: 'Path to the file containing Wikipedia article URLs',
                    default: 'data/article_urls.txt',
                })
                .option('output', {
                    alias: 'o',
                    describe: 'Path to the output CSV file',
                    default: 'data/revisions.csv',
                });
        },
        async (argv) => {
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
        },
    )
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
    .command('extract-features', 'Extract features from a set of revisions', (yargs) => {
        return yargs
            .option('input', {
                alias: 'i',
                describe: 'Path to the input CSV file',
                default: 'data/revisions.csv'
            })
            .option('output', {
                alias: 'o',
                describe: 'Path to the output CSV file',
                default: 'data/features.csv'
            });

    }, async (argv) => {
        const inputFileContent = await readFile(argv.input, 'utf8');

        const records = parse(inputFileContent, {
            columns: true,
            skip_empty_lines: true
        });

        const revisions = await records.map(record => record.revisionUrl).filter(url => url).toArray();

        console.log(`Extracting features from ${revisions.length} revisions...`);

        const features = new Map();
        let ind = 0;
        for (const revision of revisions) {
            features.set(revision, await extractFeatures(revision));
            ind += 1;
            console.log(`=> ${ind / revisions.length * 100}% complete`);
        }

        const featureNames = Object.keys(features.get(revisions[0]));

        const csvData = [];
        csvData.push(['revisionUrl', ...featureNames]);

        for (const revision of revisions) {
            const rowData = [revision];
            for (const featureName of featureNames) {
                rowData.push(features.get(revision)[featureName] || '');
            }
            csvData.push(rowData);
        }

        const csvContent = stringify(csvData);

        await writeFile(argv.output, csvContent);
    })
    .command('train', 'Train a model using extracted features and labels', (yargs) => {
        return yargs
            .option('features', {
                alias: 'f',
                describe: 'Path to the features CSV file',
                default: 'data/features.csv'
            })
            .option('labels', {
                alias: 'l',
                describe: 'Path to the labels CSV file',
                default: 'data/labels.csv'
            })
            .option('train-split', {
                alias: 't',
                describe: 'Train-test split ratio',
                default: 0.8
            })
            .option('output', {
                alias: 'o',
                describe: 'Path to the output model file',
                default: 'data/model.json'
            })
    }, async (argv) => {
        const featuresContent = await readFile(argv.features, 'utf8');
        const labelsContent = await readFile(argv.labels, 'utf8');

        const featuresRecords = parse(featuresContent, {
            columns: true,
            skip_empty_lines: true
        });

        const labelsRecords = parse(labelsContent, {
            columns: true,
            skip_empty_lines: true
        });

        const features = await featuresRecords.toArray();
        const labels = await labelsRecords.toArray();

        console.log(`Splitting data into ${argv.trainSplit * 100}% training and ${100 - argv.trainSplit * 100}% testing sets...`)

        // Split the data into training and testing sets
        const trainSplit = Math.floor(features.length * argv.trainSplit);
        const trainFeatures = features.slice(0, trainSplit);
        const testFeatures = features.slice(trainSplit);
        const trainLabels = labels.slice(0, trainSplit);
        const testLabels = labels.slice(trainSplit);

        console.log(`Training model...`);
        const dt = await train(trainFeatures, trainLabels);
        const train_accuracy = await evaluate(dt, trainFeatures, trainLabels);
        const test_accuracy = await evaluate(dt, testFeatures, testLabels);
        console.log('='.repeat(20));
        console.log(`Train accuracy: ${train_accuracy}`);
        console.log(`Test accuracy: ${test_accuracy}`);

        const model = dt.toJSON();
        await writeFile(argv.output, JSON.stringify(model));
    })
    .demandCommand(1, 'You need at least one command before moving on')
    .help().argv;
