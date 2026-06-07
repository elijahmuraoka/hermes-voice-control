const configuredAgentName = import.meta.env.VITE_HVC_AGENT_NAME?.trim();

export const agentName = configuredAgentName || "Hermes Agent";
export const agentNoun = "Hermes agent";
export const agentNounLower = "your Hermes agent";
