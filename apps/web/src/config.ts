const configuredAgentName = import.meta.env.VITE_HVC_AGENT_NAME?.trim();
const configuredApiBase = import.meta.env.VITE_API_BASE?.trim() || undefined;

export const agentName = configuredAgentName || "Bob";
export const agentNoun = agentName;
export const agentNounLower = agentName;
export const apiBase = configuredApiBase ?? (import.meta.env.DEV ? "http://127.0.0.1:8765" : "");
