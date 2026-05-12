import { GoogleGenAI, Type } from "@google/genai";
import { ExamType, QuizQuestion } from "../types";

let genAI: GoogleGenAI | null = null;

function getAI() {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please check your settings.");
    }
    genAI = new GoogleGenAI({ apiKey });
  }
  return genAI;
}

const getSystemInstruction = (examType: ExamType, secondaryDetails?: string) => {
  let trackSpecific = "";
  
  if (examType === 'Medical' || examType === 'NEET') {
    trackSpecific = `
    - Summaries: Focus on clinical relevance, anatomical accuracy, and physiological mechanisms.
    - Quiz Style: Clinical vignettes (patient scenarios), differential diagnosis questions, and questions testing memory of drug interactions and side effects.
    - Tone: Clinical, precise, and highly scientific.`;
  } else if (examType === 'Law') {
    trackSpecific = `
    - Summaries: Highlight key statutes, landmark precedents, ratio decidendi, and constitutional articles.
    - Quiz Style: Case-study-based questions applying specific laws to hypothetical situations. Include True/False logic regarding legal jurisdiction.
    - Tone: Formal, analytical, and heavily reliant on exact terminology.`;
  } else if (examType === 'UPSC') {
    trackSpecific = `
    - Summaries: Connect historical facts, geographical data, or economic concepts to current affairs and government policies.
    - Quiz Style: Complex, multi-statement questions (e.g., "Consider the following statements... Which is/are correct?"). Focus on analytical elimination.
    - Tone: Bureaucratic, comprehensive, and focused on macro-level understanding.`;
  } else {
    trackSpecific = `
    - Summaries: Use the Feynman Technique. Break complex topics into simple, digestible bullet points with relatable real-world analogies.
    - Quiz Style: Standard multiple-choice questions (MCQs), fill-in-the-blanks, and short conceptual explanation prompts.
    - Tone: Encouraging, accessible, and structured for quick memorization.`;
  }

  return `
You are the intelligence engine powering "Prodigy.", an elite, adaptive educational platform. Your primary function is to provide highly personalized learning experiences, dynamically adjusting your tone, summaries, and quiz generation based on the user's specific academic profile: ${examType}${secondaryDetails ? ` (Target Context: ${secondaryDetails})` : ''}.

Core Directives for ${examType} Track:
${trackSpecific}

Global Rules:
1. Hints first: Never give answers immediately in conversation.
2. Visual Mapping: Use Markdown tables and hierarchical bullet points.
3. LaTeX: Use LaTeX for ALL mathematical or chemical formulas (e.g. $E=mc^2$).
4. Hidden Answer Key: In the JSON output, provide the 'correctAnswer' and 'explanation' fields.
`;
};

export async function processStudyMaterial(
  fileData: { data: string; mimeType: string } | string,
  examType: ExamType,
  secondaryDetails?: string
) {
  try {
    const ai = getAI();
    const systemInstruction = getSystemInstruction(examType, secondaryDetails);

    const prompt = typeof fileData === 'string' 
      ? `Process these notes: ${fileData}`
      : {
          text: `Transcribe and refine these notes/PDF. If it's a PDF, cite page numbers. Return refined notes, a Feynman summary, a deep dive section, and a visual map.`,
        };

    const contents = typeof fileData === 'string'
      ? [{ parts: [{ text: systemInstruction }, { text: prompt as string }] }]
      : { parts: [
          { text: systemInstruction },
          { inlineData: fileData },
          { text: (prompt as { text: string }).text }
        ] };

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            refinedNotes: { type: Type.STRING },
            feynmanSummary: { type: Type.STRING },
            deepDive: { type: Type.STRING },
            visualMap: { type: Type.STRING },
          },
          required: ["title", "refinedNotes", "feynmanSummary", "deepDive", "visualMap"],
        },
      },
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Gemini Error (processStudyMaterial):", error);
    throw new Error("Failed to process study material. The AI might be temporarily unavailable.");
  }
}

export async function generateQuiz(content: string, examType: ExamType, secondaryDetails?: string): Promise<QuizQuestion[]> {
  try {
    const ai = getAI();
    const systemInstruction = getSystemInstruction(examType, secondaryDetails);

    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [
        { text: systemInstruction },
        { text: `Generate 3 high-quality quiz questions based on the following content: ${content}. Return as JSON.` }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              question: { type: Type.STRING },
              options: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                minItems: 4,
                maxItems: 4
              },
              correctAnswer: { type: Type.INTEGER, minimum: 0, maximum: 3 },
              hint: { type: Type.STRING },
              explanation: { type: Type.STRING },
            },
            required: ["id", "question", "options", "correctAnswer", "hint", "explanation"],
          },
        },
      },
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Gemini Error (generateQuiz):", error);
    throw new Error("Failed to generate quiz. Please try again in a moment.");
  }
}

export async function askAITutor(topic: string, examType: ExamType, secondaryDetails?: string) {
  try {
    const ai = getAI();
    const systemInstruction = getSystemInstruction(examType, secondaryDetails);
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        { text: systemInstruction },
        { text: `Explain the topic "${topic}" in simple terms using the Feynman Technique. Then, provide 10 relevant quiz questions based on this explanation. Return as JSON.` }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            explanation: { type: Type.STRING },
            quiz: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  question: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING }, minItems: 4, maxItems: 4 },
                  correctAnswer: { type: Type.INTEGER },
                  hint: { type: Type.STRING },
                  explanation: { type: Type.STRING }
                },
                required: ["id", "question", "options", "correctAnswer", "hint", "explanation"]
              }
            }
          },
          required: ["explanation", "quiz"]
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Gemini Error (askAITutor):", error);
    throw new Error("Tutor mode is resting. Try again in a bit!");
  }
}
