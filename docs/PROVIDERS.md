# omp-decision Providers

Decision Providers are semantic judgment engines evaluated by `omp-decision` during tool lifecycle reviews.

## The DecisionProvider Contract

```ts
export interface DecisionProvider {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  decide(request: DecisionProviderRequest): Promise<DecisionProviderResult>;
}
```

A provider receives structured request state (phase, tool name, sanitized input, execution result, and actual diff) and returns an action (`allow`, `deny`, `ask`, `pass`, `reject`, `uncertain`), reason code, explanation, and confidence score.

## Jev Provider

The default semantic review provider uses the `@typesafe-ai/sdk` client.

### Credentials

The Jev provider looks for API credentials in the following order:
1. Environment variable `TYPESAFE_API_KEY`
2. `~/.omp/secrets/typesafe_api_key`
3. `~/.pi/agent/secrets/typesafe_api_key`

### Configuration

In `.omp/decision.json`:
```json
{
  "providers": {
    "jev": {
      "enabled": true,
      "model": "jev-latest",
      "allowThreshold": 0.65,
      "denyThreshold": 0.75
    }
  }
}
```

- If `confidence < allowThreshold` or `confidence < denyThreshold`, decisions become `uncertain`, routing to the reviewer's configured `failureMode`.

## Testing Providers

Unit tests and CI environments use `FakeDecisionProvider` to simulate provider behaviors deterministically without requiring network access or API credentials.
