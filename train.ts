import DecisionTree from 'decision-tree';
import { Revision } from './extractFeatures';

export type RevisionLabels = {
    revisionUrl: string,
    label: "INCREASES_NPOV" | "DECREASES_NPOV" | "DOES_NOT_AFFECT_NPOV"
}

function mergeRevisionsAndLabels(revisions: any[], labels: RevisionLabels[]) {
    //transform features to numbers
    let features = {};
    for (const revision of revisions) {
        let feature = {};
        for (const key in revision) {
            feature[key] = Number(revision[key]);
        }
        features[revision.revisionUrl] = feature;
    }

    return revisions.map((revision, ind) => {
        return {
            label: labels[ind].label,
            ...features[revision.revisionUrl]
        }
    });
}

export async function train(revisions: any[], labels: RevisionLabels[]) {
    const training_data = mergeRevisionsAndLabels(revisions, labels);

    const dt = new DecisionTree("label", [
        "timeBetweenRevisionsAverage",
        "timeBetweenRevisionsMedian",
        "timeBetweenRevisionsQ1",
        "timeBetweenRevisionsQ3",
        "timeBetweenRevisionsStdDev",
        "timeBetweenUserRevisionsAverage",
        "timeBetweenUserRevisionsMedian",
        "timeBetweenUserRevisionsQ1",
        "timeBetweenUserRevisionsQ3",
        "timeBetweenUserRevisionsStdDev",
        "averageTimeBetweenRevisions",
        "pastRevisionsAuthoredByUser",
        "averageTimeBetweenUserAuthoredRevisions",
        "revertRiskModelScore",
        "percPastRevisionsAuthored"
    ]);

    console.log(`Sample training data row: ${JSON.stringify(training_data[0])}`);

    console.log(`Training decision tree from ${training_data.length} data points...`)

    dt.train(training_data);
    return dt;
}

export async function evaluate(dt: DecisionTree, revisions: Revision[], labels: RevisionLabels[]) {
    const data = mergeRevisionsAndLabels(revisions, labels);
    const accuracy = dt.evaluate(data);
    return accuracy;
}