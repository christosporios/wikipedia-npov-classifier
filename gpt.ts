import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const getPrompt = (diffText: string): string => {
    return `According to the wikipedia definition of NPOV, classify the following diff as either "INCREASES npov", "DECREASES npov" or "DOES NOT AFFECT npov"
    Answer only with the classification label and nothing else.

    Text: ${diffText}

    Classification: `;
}

export async function classifyWithGPT(diffText: string): Promise<string> {
    console.log(`Classifying diff...`)
    const prompt = getPrompt(diffText);

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [{
                role: 'system',
                content: 'You are a classifier that decides whether a wikipedia change is NPOV increasing, NPOV decreasing or neutral'
            }, {
                role: 'user',
                content: prompt
            }],
            temperature: 0,
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error('Failed to get classification from OpenAI:', error);
        throw error;
    }
}

export async function getEmbedding(text: string, dimensions: number): Promise<number[]> {
    console.log(`Getting embedding...`)
    try {
        const response = await openai.embeddings.create({
            // use first 15k characters of the text
            input: [text.slice(0, 15000)],
            model: 'text-embedding-3-small',
            dimensions: dimensions
        });

        return response.data[0].embedding;
    } catch (error) {
        console.error('Failed to get embedding from OpenAI:', error);
        throw error;
    }
}
