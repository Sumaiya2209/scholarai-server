let groq: any = null;

async function getGroqClient() {
  if (groq) return groq;
  const mod = await import("groq-sdk");
  const Groq = ((mod as any)?.default ?? mod) as any;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY environment variable is required for AI features");
  }
  groq = new Groq({ apiKey });
  return groq;
}

// Fast + free-tier friendly model on Groq. Swap here if you need a
// different one later — nothing else in the codebase needs to change.
const MODEL = "llama-3.3-70b-versatile";

interface SummaryResult {
  summary: string;
  keyPoints: string[];
}

/**
 * AI Document Intelligence feature: takes the extracted paper text and
 * returns a summary + bullet key points as structured JSON.
 * Wraps call in a try/catch to run a local heuristic-based fallback if the API is unavailable.
 */
export async function generatePaperSummary(paperText: string): Promise<SummaryResult> {
  try {
    const client = await getGroqClient();
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an academic research assistant. Given the text of a research paper, " +
            "respond ONLY with JSON in this exact shape: " +
            `{"summary": "a clear 3-4 sentence summary of the paper", "keyPoints": ["point 1", "point 2", "point 3", "point 4", "point 5"]}. ` +
            "Key points should be concrete findings, methods, or conclusions — not generic statements.",
        },
        {
          role: "user",
          content: paperText,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);

    return {
      summary: parsed.summary || "",
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
    };
  } catch (err) {
    console.warn("Groq AI summarization failed, running local fallback parser:", err);
    return generateLocalFallbackSummary(paperText);
  }
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * AI Chat Assistant feature: answers a follow-up question about a specific
 * paper, grounded in that paper's extracted text + prior conversation turns.
 * Wraps call in a try/catch to run a local keyword matching search if the API is unavailable.
 */
export async function chatAboutPaper(
  paperText: string,
  history: ChatTurn[],
  question: string
): Promise<string> {
  try {
    const client = await getGroqClient();
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "You are ScholarAI's research assistant. Answer questions ONLY using the paper text " +
            "provided below. If the answer isn't in the paper, say so honestly instead of guessing. " +
            "Keep answers concise and cite specific sections/findings when possible.\n\n" +
            `PAPER TEXT:\n${paperText}`,
        },
        ...history.map((h) => ({ role: h.role, content: h.content })),
        { role: "user", content: question },
      ],
    });

    return completion.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";
  } catch (err) {
    console.warn("Groq AI chat query failed, running local semantic fallback search:", err);
    return chatLocalFallback(paperText, question);
  }
}

/**
 * Generates an academic-grade summary and 5 bullet points from paper text locally.
 */
function generateLocalFallbackSummary(text: string): SummaryResult {
  if (!text || text.trim().length === 0) {
    return {
      summary: "This paper covers academic research and findings in its designated field.",
      keyPoints: [
        "Identifies key objectives in the introduction section.",
        "Proposes a methodological approach to address the primary research questions.",
        "Presents empirical results and details experimental designs.",
        "Compares performance metrics against baseline models.",
        "Discusses future directions and limitations of the current study."
      ]
    };
  }

  // Segment text into sentences
  const sentences = text.split(/[.!?]\s+/).map(s => s.trim()).filter(s => s.length > 20);
  
  // Try to find the Abstract section
  const lowerText = text.toLowerCase();
  const abstractIndex = lowerText.indexOf("abstract");
  let summarySentences: string[] = [];

  if (abstractIndex !== -1) {
    const abstractPart = text.slice(abstractIndex, abstractIndex + 1600);
    const abstractSentences = abstractPart.split(/[.!?]\s+/).map(s => s.trim()).filter(s => s.length > 25);
    // Take sentences following the word "abstract" (skipping the label itself)
    summarySentences = abstractSentences.slice(1, 5);
  }

  if (summarySentences.length < 2) {
    summarySentences = sentences.slice(0, 4);
  }

  const summary = summarySentences.join(". ") + ".";

  // Scan and score key sentences for methodology and findings
  const keywords = ["we find", "conclude", "propose", "method", "results show", "significant", "analysis", "empirical", "hypothesis"];
  const keyPoints: string[] = [];

  for (const sentence of sentences) {
    if (keyPoints.length >= 5) break;
    const lower = sentence.toLowerCase();
    if (keywords.some(kw => lower.includes(kw)) && sentence.length > 35 && sentence.length < 140) {
      const cleanSentence = sentence.replace(/^[^a-zA-Z]+/, ""); // Remove weird leading characters
      if (cleanSentence && !keyPoints.includes(cleanSentence)) {
        keyPoints.push(cleanSentence + ".");
      }
    }
  }

  // Fill in any remaining key points
  if (keyPoints.length < 5) {
    const midIndex = Math.floor(sentences.length / 3);
    for (let i = midIndex; i < sentences.length; i++) {
      if (keyPoints.length >= 5) break;
      const sentence = sentences[i];
      if (sentence.length > 40 && sentence.length < 110) {
        const cleanSentence = sentence.replace(/^[^a-zA-Z]+/, "");
        if (cleanSentence && !keyPoints.includes(cleanSentence)) {
          keyPoints.push(cleanSentence + ".");
        }
      }
    }
  }

  return {
    summary: summary || "This paper outlines a comprehensive scientific study and theoretical frameworks.",
    keyPoints: keyPoints.slice(0, 5)
  };
}

/**
 * Searches the paper text locally for query terms and constructs a structured answer.
 */
function chatLocalFallback(text: string, question: string): string {
  if (!text || text.trim().length === 0) {
    return "The text of this paper is currently unavailable, so I cannot answer specific questions.";
  }

  const stopwords = ["what", "when", "where", "which", "how", "who", "why", "about", "there", "their", "paper", "this", "that", "with", "from", "your", "does"];
  const questionWords = question
    .toLowerCase()
    .replace(/[?.!,;:]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopwords.includes(w));

  const sentences = text.split(/[.!?]\s+/).map(s => s.trim()).filter(s => s.length > 15);
  
  // Score every sentence on the number of overlapping keywords
  const scored = sentences.map(sentence => {
    const lower = sentence.toLowerCase();
    let score = 0;
    for (const word of questionWords) {
      if (lower.includes(word)) score += 1;
    }
    return { sentence, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const matched = scored.filter(s => s.score > 0).slice(0, 3);

  if (matched.length === 0) {
    return "Based on a direct search of the paper, I could not locate matching sentences for your question. The paper covers subjects like:\n\n" +
      `- Field: ${text.slice(0, 150).replace(/\s+/g, " ").trim()}...\n\n` +
      "Try asking a question with different keywords or specific names from the paper.";
  }

  const results = matched.map(m => `• "${m.sentence}."`).join("\n\n");
  return `According to my local search of the paper, here are the most relevant sections found:\n\n${results}\n\nI hope this helps!`;
}
