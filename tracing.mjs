import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { env } from './utils.mjs';

// Configurable OTLP gRPC endpoint (defaults to local collector)
const otlpGrpcEndpoint = env('OTLP_GRPC_ENDPOINT', 'grpc://localhost:4317');
const exporter = new OTLPTraceExporter({ url: otlpGrpcEndpoint });

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
