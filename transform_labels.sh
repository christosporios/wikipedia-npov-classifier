jq -r '.[] | .data.revisionUrl as $url | .annotations[] | .result[] | {revisionUrl: $url, label: .value.choices[0]} | [.revisionUrl, .label] | @csv' ./data/labels.json > ./data/transformed_labels.csv
