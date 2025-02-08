import { getEncoding } from 'js-tiktoken';
import { RecursiveCharacterTextSplitter } from './ai/text-splitter';



export const basePromptToAiModel = () => {
  const now = new Date().toISOString();
  return `You are an expert researcher. Today is ${now}. Follow these instructions when responding:
  - You may be asked to research subjects that is after your knowledge cutoff, assume the user is right when presented with news.
  - The user is a highly experienced analyst, no need to simplify it, be as detailed as possible and make sure your response is correct.
  - Be highly organized.
  - Suggest solutions that I didn't think about.
  - Be proactive and anticipate my needs.
  - Treat me as an expert in all subject matter.
  - Mistakes erode my trust, so be accurate and thorough.
  - Provide detailed explanations, I'm comfortable with lots of detail.
  - Value good arguments over authorities, the source is irrelevant.
  - Consider new technologies and contrarian ideas, not just the conventional wisdom.
  - You may use high levels of speculation or prediction, just flag it for me.`;
};



/**
 * Generates a SERP (Search Engine Results Page) query prompt for AI-based research generation.
 *
 * This function constructs a structured prompt to guide an AI model in generating a list of search queries
 * based on a user-provided topic. If prior research learnings are available, they are appended to refine
 * and improve the specificity of the generated queries.
 *
 * @param {string} query - The main research query provided by the user.
 * @param {number} numQueries - The maximum number of search queries to generate.
 * @param {string[]} [learnings] - (Optional) A list of insights from previous research to guide query generation.
 * @returns {string} - A well-formatted prompt string to be passed to an AI model.
 *
 * @example
 * // Basic usage without learnings
 * const prompt = generateSerpPromptWithLearnings("Effects of AI on healthcare", 5);
 * console.log(prompt);
 *
 * // Usage with learnings
 * const promptWithLearnings = generateSerpPromptWithLearnings("Effects of AI on healthcare", 5, [
 *   "AI assists in early disease detection.",
 *   "Machine learning improves patient diagnostics."
 * ]);
 * console.log(promptWithLearnings);
 */
export const generateSerpPromptWithLearnings = (query: string, numQueries: number, learnings?: string[]): string => {
  // Base prompt structure
  let prompt = `Given the following prompt from the user, generate a list of SERP queries to research the topic.
Return a maximum of ${numQueries} queries, but feel free to return less if the original prompt is clear.
Make sure each query is unique and not similar to each other:
<prompt>${query}</prompt>`;

  // Append learnings only if provided
  if (learnings && learnings.length > 0) {
    prompt += `\n\nHere are some learnings from previous research, use them to generate more specific queries:\n${learnings.join('\n')}`;
  }

  return prompt;
};


/**
 * Generates a structured AI prompt for analyzing SERP content.
 * 
 * @param {string} query - The original search query.
 * @param {string[]} contents - Extracted and trimmed SERP markdown content.
 * @param {number} numLearnings - Maximum number of learnings to extract.
 * @returns {string} - The formatted AI prompt.
 */
export const generateSerpAnalysisPrompt = (query: string, contents: string[], numLearnings: number): string => {
  return `Given the following contents from a SERP search for the query <query>${query}</query>,
generate a list of learnings from the contents. Return a maximum of ${numLearnings} learnings, but feel free to return
less if the contents are clear. Make sure each learning is unique and not similar to each other. The learnings should be
concise and to the point, as detailed and information-dense as possible. Make sure to include any entities like people,
places, companies, products, things, etc., in the learnings, as well as any exact metrics, numbers, or dates.
The learnings will be used to research the topic further.

<contents>${contents.map(content => `<content>\n${content}\n</content>`).join('\n')}</contents>`;
};


export const finalReportPrompt = (prompt: string, learningsString: string) => {
  return `Given the following prompt from the user, write a final report on the topic using the learnings 
from research. Make it as as detailed as possible, aim for 3 or more pages, include ALL the learnings from research:
\n\n<prompt>${prompt}</prompt>
\n\nHere are all the learnings from previous research:
\n\n<learnings>\n${learningsString}\n</learnings>`;
}


const MinChunkSize = 140;
const encoder = getEncoding('o200k_base');

// trim prompt to maximum context size
export function trimPrompt(
  prompt: string,
  contextSize = Number(process.env.CONTEXT_SIZE) || 128_000,
) {
  if (!prompt) {
    return '';
  }

  const length = encoder.encode(prompt).length;
  if (length <= contextSize) {
    return prompt;
  }

  const overflowTokens = length - contextSize;
  // on average it's 3 characters per token, so multiply by 3 to get a rough estimate of the number of characters
  const chunkSize = prompt.length - overflowTokens * 3;
  if (chunkSize < MinChunkSize) {
    return prompt.slice(0, MinChunkSize);
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: 0,
  });
  const trimmedPrompt = splitter.splitText(prompt)[0] ?? '';

  // last catch, there's a chance that the trimmed prompt is same length as the original prompt, due to how tokens are split & innerworkings of the splitter, handle this case by just doing a hard cut
  if (trimmedPrompt.length === prompt.length) {
    return trimPrompt(prompt.slice(0, chunkSize), contextSize);
  }

  // recursively trim until the prompt is within the context size
  return trimPrompt(trimmedPrompt, contextSize);
}