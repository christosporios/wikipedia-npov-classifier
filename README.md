# Wikipedia NPOV Classifier

A classifier that labels wikipedia edits according to whether they increase [Neutral Point Of View (NPOV)](https://en.wikipedia.org/wiki/Wikipedia:Neutral_point_of_view).

## Instructions

1. [Install node and npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)
2. Install requirements: `npm install`.
3. Compile with tsc: `tsc`.
4. Run `node ./dist/cli.js`

### Commands
```
cli.js <command>

Commands (run with --help to see arguments and flags)
  cli.js revisions         Fetch revisions for Wikipedia articles
  cli.js random            Fetch random Wikipedia articles
  cli.js extract-features  Extract features from a set of revisions
  cli.js train             Train a model using extracted features and labels
  cli.js compare-to-gpt    Compare a set of labels to GPT-4 labels
```

### Pipeline
To train a model:

1. Extract a set of random wikipedia articles using `random` (or write a text file with article urls yourself, one per line)
2. Fetch all revisions for wikpedia articles using `revisions`
3. Label the examples however you want, in a CSV with two columns: `revisionUrl` and `label`. `label` should be one of `INCREASES npov`, `DECREASES npov`, `DOES NOT AFFECT npov`.
4. Optionally, you can compare your labels to GPT-4 with `compare-to-gpt`.
5. Train the model: `train`

## Authors
Louis Guerin and Christos Porios
