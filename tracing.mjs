import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

// Point to the local Datadog Agent
const exporter = new OTLPTraceExporter({
  url: 'grpc://localhost:4317',
});

const provider = new NodeTracerProvider({
  spanProcessor: new SimpleSpanProcessor(exporter),
});
provider.register();

registerInstrumentations({
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
  ],
});
