import type { DecisionProvider } from "./types.js";

export class DecisionProviderRegistry {
  readonly #providers = new Map<string, DecisionProvider>();

  register(provider: DecisionProvider): void {
    if (this.#providers.has(provider.id)) throw new Error(`Decision provider already registered: ${provider.id}`);
    this.#providers.set(provider.id, provider);
  }

  get(id: string): DecisionProvider | undefined {
    return this.#providers.get(id);
  }
}
