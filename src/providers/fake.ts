import type { DecisionProvider, DecisionProviderRequest, DecisionProviderResult } from "./types.js";

export class FakeDecisionProvider implements DecisionProvider {
  readonly id: string;
  readonly #handler: (request: DecisionProviderRequest) => DecisionProviderResult | Promise<DecisionProviderResult>;

  constructor(
    handler: (request: DecisionProviderRequest) => DecisionProviderResult | Promise<DecisionProviderResult>,
    id = "fake",
  ) {
    this.id = id;
    this.#handler = handler;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async decide(request: DecisionProviderRequest): Promise<DecisionProviderResult> {
    return this.#handler(request);
  }
}
