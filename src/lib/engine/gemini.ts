export function geminiApiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    ""
  );
}

export function geminiConfigured(): boolean {
  return Boolean(geminiApiKey());
}

export function geminiLiveModel(): string {
  return process.env.LLM_REALTIME_MODEL || "gemini-3.1-flash-live-preview";
}

export function geminiLiveVoice(): string {
  return process.env.LLM_REALTIME_VOICE || "Kore";
}

export function geminiLiveModelCandidates(): string[] {
  const primary = geminiLiveModel();
  return [
    primary,
    "gemini-3.1-flash-live-preview",
    "gemini-2.5-flash-native-audio-latest",
    "gemini-2.5-flash-preview-native-audio-dialog",
    "gemini-2.5-flash-native-audio-preview-12-2025",
    "gemini-2.5-flash-native-audio-preview-09-2025",
    "gemini-live-2.5-flash-preview",
  ].filter((model, i, all) => all.indexOf(model) === i);
}
