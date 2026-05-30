import { GoogleGenAI, Type } from "@google/genai";
import { ExamType } from "../types/index";

let genAI: any = null;

function getAI() {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "undefined" || apiKey === "null" || apiKey.trim() === "") {
      console.error("GEMINI_API_KEY is missing or invalid in environment.");
      throw new Error("GEMINI_API_KEY is missing. Please set it in Settings > Secrets.");
    }
    console.log(`Initializing Gemini SDK with key (length: ${apiKey.length}, starts with: ${apiKey.substring(0, 4)}...)`);
    genAI = new GoogleGenAI({ apiKey });
  }
  return genAI;
}

const DEFAULT_MODEL = "gemini-2.0-flash"; // Recommended model
const PRO_MODEL = "gemini-2.0-flash"; // Flash is fast and capable for tutor too

const getSystemInstruction = (examType: ExamType, secondaryDetails?: string) => {
  let trackSpecific = "";
  
  if (examType === 'Medical' || examType === 'NEET') {
    trackSpecific = `
    - Summaries: Focus on clinical relevance, anatomical accuracy, and physiological mechanisms.
    - Quiz Style: Clinical vignettes (patient scenarios), differential diagnosis questions.
    - Tone: Clinical, precise.`;
  } else if (examType === 'Law') {
    trackSpecific = `
    - Summaries: Highlight statues, landmark precedents, ratio decidendi.
    - Quiz Style: Case-study-based questions.
    - Tone: Formal, analytical.`;
  } else if (examType === 'UPSC') {
    trackSpecific = `
    - Summaries: Connect facts/data to current affairs and policies.
    - Quiz Style: Multi-statement analytical questions.
    - Tone: Bureaucratic, comprehensive.`;
  } else {
    trackSpecific = `
    - Summaries: Use the Feynman Technique. Simple, digestible bullet points with analogies.
    - Quiz Style: Standard MCQs and conceptual prompts.
    - Tone: Encouraging, accessible.`;
  }

  return `
You are the intelligence engine powering "Prodigy", an elite educational platform. 
Academic track: ${examType}${secondaryDetails ? ` (Context: ${secondaryDetails})` : ''}.

Core Directives for ${examType}:
${trackSpecific}

Global Rules:
1. Hints first: Never give answers immediately.
2. Visual Mapping: Use Markdown tables and bullet points.
3. LaTeX: Use LaTeX for ALL mathematical or chemical formulas (e.g. $E=mc^2$).
4. JSON: Always output valid JSON as specified.
`;
};

export async function processStudyMaterialBackend(
  fileData: { data: string; mimeType: string } | string,
  examType: ExamType,
  secondaryDetails?: string
) {
  const ai = getAI();
  const systemInstruction = getSystemInstruction(examType, secondaryDetails);

  const prompt = typeof fileData === 'string' 
    ? `Process these notes: ${fileData}`
    : { text: `Transcribe and refine these notes/PDF. Return refined notes, a Feynman summary, a deep dive section, and a visual map.` };

  const contents = typeof fileData === 'string'
    ? prompt
    : { parts: [{ inlineData: fileData }, { text: (prompt as any).text }] };

  const response = await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents,
    config: {
      systemInstruction,
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
}

export async function generateQuizBackend(content: string, examType: ExamType, secondaryDetails?: string) {
  const ai = getAI();
  const systemInstruction = getSystemInstruction(examType, secondaryDetails);

  const response = await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: `Generate 3 high-quality quiz questions based on the following content: ${content}.`,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            question: { type: Type.STRING },
            options: { type: Type.ARRAY, items: { type: Type.STRING }, minItems: 4, maxItems: 4 },
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
}

export async function askAITutorBackend(topic: string, examType: ExamType, secondaryDetails?: string) {
  const ai = getAI();
  const systemInstruction = getSystemInstruction(examType, secondaryDetails);
  
  const response = await ai.models.generateContent({
    model: PRO_MODEL,
    contents: `Explain "${topic}" using Feynman Technique. Provide 10 quiz questions.`,
    config: {
      systemInstruction,
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
}

export async function processYouTubeVideoBackend(url: string, examType: ExamType, secondaryDetails?: string) {
  const ai = getAI();
  const systemInstruction = getSystemInstruction(examType, secondaryDetails);

  const response = await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: `Search and summarize YouTube video: ${url}. Return refined notes, Feynman summary, deep dive, and visual map.`,
    config: {
      systemInstruction,
      tools: [{ googleSearch: {} }],
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
}

export async function generatePuzzleBatchBackend(examType: ExamType, secondaryDetails?: string, recentLearnings?: string) {
  const ai = getAI();
  const systemInstruction = getSystemInstruction(examType, secondaryDetails);
  const contextPrompt = recentLearnings ? `Puzzles from recent topics: ${recentLearnings}.` : "";

  const response = await ai.models.generateContent({
    model: DEFAULT_MODEL, 
    contents: `Generate batch of 15 Logical/IQ Puzzles for ${examType}. ${contextPrompt} Puzzles get harder.`,
    config: {
      systemInstruction,
      temperature: 0.8,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            question: { type: Type.STRING },
            answer: { type: Type.STRING },
            hint: { type: Type.STRING },
            difficulty: { type: Type.STRING, enum: ["Easy", "Medium", "Hard"] },
            topic: { type: Type.STRING }
          },
          required: ["id", "question", "answer", "hint", "difficulty", "topic"]
        }
      }
    }
  });

  return JSON.parse(response.text);
}
