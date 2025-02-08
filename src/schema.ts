import { z as zodSchemaValidation } from 'zod'; // Renamed 'z' to 'zodSchema' for clarity

/**
 * Generates a Zod schema to validate the structure of SERP (Search Engine Results Page) queries.
 *
 * This schema ensures that:
 * - The input is an object containing a `queries` field.
 * - The `queries` field is an array of objects.
 * - Each object in the array contains:
 *   - A `query` field (string) representing the actual search query.
 *   - A `researchGoal` field (string) that describes the intent and next steps for research.
 *
 * @param {number} numQueries - The maximum number of queries allowed in the array.
 * @returns {zod.ZodObject} - A Zod validation schema for validating SERP query results.
 */
export const generateSerpSchema = (numQueries: number) => {
    return zodSchemaValidation.object({
      // The outer object must contain a `queries` field
      queries: zodSchemaValidation
        .array(
          // The `queries` field must be an array of objects
          zodSchemaValidation.object({
            // Each object in the array must have a `query` field
            query: zodSchemaValidation.string().describe(
              'The SERP query' // A simple search query string
            ),
  
            // Each object must also have a `researchGoal` field
            researchGoal: zodSchemaValidation
              .string()
              .describe(
                `First talk about the goal of the research that this query is meant to accomplish, 
                then go deeper into how to advance the research once the results are found, 
                mention additional research directions. Be as specific as possible, 
                especially for additional research directions.` // Descriptive metadata about the research goal
              ),
          })
        )
        .describe(`List of SERP queries, max of ${numQueries}`), // Limit the number of queries
    });
  };



/**
 * Generates a Zod schema to validate the AI-generated learnings and follow-up questions.
 * 
 * @param {number} numLearnings - Maximum number of learnings allowed.
 * @param {number} numFollowUpQuestions - Maximum number of follow-up questions allowed.
 * @returns {z.ZodObject} - A Zod schema for validating AI responses.
 */
export const generateSerpAnalysisSchema = (numLearnings: number, numFollowUpQuestions: number) => {
    return zodSchemaValidation.object({
      learnings: zodSchemaValidation
        .array(zodSchemaValidation.string())
        .describe(`List of learnings, max of ${numLearnings}`),
      followUpQuestions: zodSchemaValidation
        .array(zodSchemaValidation.string())
        .describe(`List of follow-up questions to research the topic further, max of ${numFollowUpQuestions}`),
    });
  };  