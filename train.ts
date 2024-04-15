// You may need to install ml-cart using npm or yarn
import { DecisionTreeClassifier as DecisionTree } from 'ml-cart';
import { Revision } from './extractFeatures';

export type RevisionLabels = {
    revisionUrl: string;
    label: 'INCREASES npov' | 'DECREASES npov' | 'DOES NOT AFFECT npov';
};

function mergeRevisionsAndLabels(revisions: any[], labels: RevisionLabels[]) {
    // Transform features to numbers and extract labels
    let featureList = [
        'averageTimeBetweenRevisions',
        'revertRiskModelScore',
        'percPastRevisionsAuthored',
        'timeBetweenRevisionsAverage',
        ''
    ];
    let features = [];
    let featureLabels = [];
    for (const revision of revisions) {
        let featureArray = [];
        for (const key in revision) {
            if (!featureList.includes(key)) continue;
            featureArray.push(Number(revision[key]));
        }
        features.push(featureArray);
    }

    // Assuming labels are in the same order as revisions
    console.log(labels);
    featureLabels = labels.map((label) => {
        switch (label.label) {
            case 'INCREASES npov':
                return 1;
            case 'DECREASES npov':
                return -1;
            default:
                return 0;
        }
    });

    return { features, featureLabels };
}

export async function train(revisions: any[], labels: RevisionLabels[]) {
    const { features, featureLabels } = mergeRevisionsAndLabels(revisions, labels);

    const dt = new DecisionTree({
        gainFunction: 'gini',
        maxDepth: 10,
        minNumSamples: 3,
    });

    console.log(`Training decision tree from ${features.length} data points...`);

    console.log(features, featureLabels)
    dt.train(features, featureLabels);
    return dt;
}

export async function evaluate(dt: DecisionTree, revisions: Revision[], labels: RevisionLabels[]) {
    const { features, featureLabels } = mergeRevisionsAndLabels(revisions, labels);

    const predictions = dt.predict(features);

    // Convert labels from string to numerical format to match earlier conversion
    const numericalLabels = labels.map(label => {
        switch (label.label) {
            case 'INCREASES npov':
                return 1;
            case 'DECREASES npov':
                return -1;
            default:
                return 0;
        }
    });

    // Define classes based on your label encoding
    const classes = [1, -1, 0];
    let stats = {
        overallAccuracy: 0,
        classStats: {},
    };

    let correct = 0;
    predictions.forEach((pred, index) => {
        if (pred === numericalLabels[index]) correct++;
    });
    stats.overallAccuracy = correct / predictions.length;

    for (const classVal of classes) {
        let truePositives = 0;
        let falsePositives = 0;
        let falseNegatives = 0;

        for (let i = 0; i < predictions.length; i++) {
            if (predictions[i] === classVal && numericalLabels[i] === classVal) {
                truePositives++;
            }
            if (predictions[i] === classVal && numericalLabels[i] !== classVal) {
                falsePositives++;
            }
            if (predictions[i] !== classVal && numericalLabels[i] === classVal) {
                falseNegatives++;
            }
        }

        const precision = truePositives / (truePositives + falsePositives) || 0;
        const recall = truePositives / (truePositives + falseNegatives) || 0;
        const f1Score = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

        stats.classStats[classVal] = {
            precision,
            recall,
            f1Score,
        };
    }

    return stats;
}

