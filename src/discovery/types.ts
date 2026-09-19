export interface DiscoveryCandidate {
  name: string;
  description?: string | undefined;
  source?: string | undefined;
}

export interface DiscoveryMatch extends DiscoveryCandidate {
  score: number;
  reasons: string[];
}

export interface DiscoveryResult {
  query: string;
  matches: DiscoveryMatch[];
  strategy: "lexical" | "semantic";
}
