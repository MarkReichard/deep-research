import * as fs from 'fs/promises';
import * as readline from 'readline';

import { deepResearch, writeFinalReport } from './deep-research';
import { generateFeedback } from './feedback';


const readLineOfUserInput = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const getUserInput = (query: string): Promise<string> =>
  new Promise(resolve => readLineOfUserInput.question(query, resolve));

const notifyUser = (message:string): void => console.log(message);

const getSearchBreadthAndDepth = async (): Promise<[number, number]> => {
  const breadth =
    parseInt(
      await getUserInput('Enter research breadth (recommended 2-10, default 4): '),
      10
    ) || 4;

  const depth =
    parseInt(
      await getUserInput('Enter research depth (recommended 1-5, default 2): '),
      10
    ) || 2;

  return [breadth, depth];
};

const getFollowUpAnswers = async (initialQuery: string): Promise<string[]> => {
  // Generate follow-up questions
  const followUpQuestions = await generateFeedback({ query: initialQuery });

  notifyUser(
    '\nTo better understand your research needs, please answer these follow-up questions:'
  );

  // Collect answers to follow-up questions
  const answers: string[] = [];
  for (const question of followUpQuestions) {
    const answer = await getUserInput(`\n${question}\nYour answer: `);
    answers.push(answer);
  }

  return followUpQuestions.map((q, i) => `Q: ${q}\nA: ${answers[i]}`);
};

const writeAndSaveFinalReport = async (
  combinedQuery: string,
  learnings: string[],
  visitedUrls: string[]
): Promise<void> => {
  notifyUser('Writing final report...');

  const report = await writeFinalReport({
    prompt: combinedQuery,
    learnings,
    visitedUrls,
  });

  // Save report to file
  await fs.writeFile('output.md', report, 'utf-8');

  notifyUser(`\n\nFinal Report:\n\n${report}`);
  notifyUser('\nReport has been saved to output.md');
};

const getResearchParameters = async (): Promise<[string, number, number]> => {
  const initialQuery = await getUserInput('What would you like to research? ');
  const [searchBreadth, searchDepth] = await getSearchBreadthAndDepth();
  return [initialQuery, searchBreadth, searchDepth];
};

const compileResearchQuery = (
  initialQuery: string,
  followUpQA: string[]
): string => `
Initial Query: ${initialQuery}
Follow-up Questions and Answers:
${followUpQA.join('\n')}
`;

const displayResearchResults = (
  learnings: string[],
  visitedUrls: string[]
): void => {
  notifyUser(`\n\nLearnings:\n\n${learnings.join('\n')}`);
  notifyUser(`\n\nVisited URLs (${visitedUrls.length}):\n\n${visitedUrls.join('\n')}`);
};

// run the agent
const run = async () => {
  // Get user input and parameters
  const [initialQuery, searchBreadth, searchDepth] = await getResearchParameters();

  notifyUser(`Creating research plan...`);

  // Collect follow-up responses
  const followUpQA = await getFollowUpAnswers(initialQuery);

  // Prepare research query
  const combinedQuery = compileResearchQuery(initialQuery, followUpQA);

  notifyUser('\nResearching your topic...');

  // Conduct deep research
  const { learnings, visitedUrls } = await deepResearch({
    query: combinedQuery,
    breadth: searchBreadth,
    depth: searchDepth,
  });

  // Display research results
  displayResearchResults(learnings, visitedUrls);

  // Write and save the final report
  await writeAndSaveFinalReport(combinedQuery, learnings, visitedUrls);

  readLineOfUserInput.close();
};


run().catch(console.error);
