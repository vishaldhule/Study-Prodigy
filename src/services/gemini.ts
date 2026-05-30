import { ExamType, QuizQuestion } from "../types";

const API_BASE = import.meta.env.VITE_API_URL || "";

async function fetchWithRetry(url: string, options: RequestInit, retries = 2): Promise<Response> {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    return response;
  } catch (error) {
    if (retries > 0) {
      console.warn(`Fetch failed, retrying... (${retries} left). Error:`, error);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

export async function processStudyMaterial(
  fileData: { data: string; mimeType: string } | string,
  examType: ExamType,
  secondaryDetails?: string
) {
  try {
    const response = await fetchWithRetry(`${API_BASE}/api/gemini/process-material`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileData, examType, secondaryDetails }),
    });
    return await response.json();
  } catch (error: any) {
    console.error("Client Error (processStudyMaterial):", error);
    throw new Error(error.message || "The AI is currently catching its breath. Please try again.");
  }
}

export async function generateQuiz(content: string, examType: ExamType, secondaryDetails?: string): Promise<QuizQuestion[]> {
  try {
    const response = await fetchWithRetry(`${API_BASE}/api/gemini/generate-quiz`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, examType, secondaryDetails }),
    });
    return await response.json();
  } catch (error: any) {
    console.error("Client Error (generateQuiz):", error);
    throw new Error("Quiz generation failed. Ensure your connection is stable.");
  }
}

export async function askAITutor(topic: string, examType: ExamType, secondaryDetails?: string) {
  try {
    const response = await fetchWithRetry(`${API_BASE}/api/gemini/ask-tutor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, examType, secondaryDetails }),
    });
    return await response.json();
  } catch (error: any) {
    console.error("Client Error (askAITutor):", error);
    throw new Error("Tutor mode encountered an error. Try a different topic!");
  }
}

export async function processYouTubeVideo(
  url: string,
  examType: ExamType,
  secondaryDetails?: string
) {
  try {
    const response = await fetchWithRetry(`${API_BASE}/api/gemini/process-youtube`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, examType, secondaryDetails }),
    });
    return await response.json();
  } catch (error: any) {
    console.error("Client Error (processYouTubeVideo):", error);
    throw new Error(error.message || "Failed to process YouTube video. Link may be restricted.");
  }
}

export async function generatePuzzleBatch(examType: ExamType, secondaryDetails?: string, recentLearnings?: string) {
  try {
    const response = await fetchWithRetry(`${API_BASE}/api/gemini/puzzle-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ examType, secondaryDetails, recentLearnings }),
    });
    return await response.json();
  } catch (error: any) {
    console.error("Client Error (generatePuzzleBatch):", error);
    return [
      {
        id: "offline-1",
        question: "Connectivity issue detected. What is the best next step?",
        answer: "Check your internet and refresh the trail.",
        hint: "Restarting works wonders.",
        difficulty: "Easy",
        topic: "Troubleshooting"
      }
    ];
  }
}
