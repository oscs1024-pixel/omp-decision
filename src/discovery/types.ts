export interface DiscoveryCandidate {
  name: string;
  description?: string;
  source?: string;
  active?: boolean;
}

export interface DiscoveryMatch extends DiscoveryCandidate {
  score: number;
  reasons: string[];
}

export interface DiscoveryResult {
  query: string;
  matches: DiscoveryMatch[];
  strategy: "lexical";
}
