"""Generate the pinned Alloy privacy candidate; no data-plane reimplementation."""
import json
from pathlib import Path
import re
import sys
from collector_privacy import TRACE_STORE_METRICS

CONFIG = Path(__file__).resolve().parents[2]/'infra/observability/pilot'


def literal(value):
    return json.dumps(value, ensure_ascii=True)


def pattern(values):
    return '^('+'|'.join(re.escape(value) for value in values)+')$'


def enum_rule(key, values, *, fallback='_OTHER'):
    return f'set(attributes[{literal(key)}], {literal(fallback)}) where attributes[{literal(key)}] != nil and not IsMatch(attributes[{literal(key)}], {literal(pattern(values))})'


def only(statement, condition):
    command, separator, predicate = statement.partition(' where ')
    return command+' where ('+condition+')'+(' and ('+predicate+')' if separator else '')


def block(kind, context, statements):
    return '  '+kind+'_statements {\n    context = '+literal(context)+'\n    statements = [\n'+''.join(
        '      `'+statement+'`,\n' for statement in statements)+'    ]\n  }\n'


def render():
    policy = json.loads((CONFIG/'privacy-policy.json').read_text())
    notification = policy['notifications']
    resource = ['keep_keys(attributes, ["service.name", "deployment.environment.name", "service.version"])',
        enum_rule('service.name', policy['services']),
        enum_rule('deployment.environment.name', policy['environments']),
        'set(attributes["service.version"], "_OTHER") where attributes["service.version"] != nil and not IsMatch(attributes["service.version"], "^([0-9a-f]{40}|[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,4})$")']
    scope = ['set(name, "inside-collector")', 'set(version, "")', 'keep_keys(attributes, [])']
    http_rules = [
        enum_rule('http.route', policy['routes']),
        enum_rule('http.request.method', policy['methods']),
        enum_rule('http.request.outcome', ['completed','aborted','timeout'])]
    boss_rules = [
        enum_rule('messaging.system', ['pg-boss']),
        enum_rule('messaging.destination.name', policy['queues']),
        enum_rule('messaging.operation.name', policy['operations'])]
    state_rules = [
        enum_rule('messaging.operation.type', ['send','receive','process','settle']),
        enum_rule('pgboss.job.state', ['deferred','ready','blocked','active','failed'])]
    errors = ['aborted','timeout','job_error']
    status_rule = 'delete_key(attributes, "http.response.status_code") where attributes["http.response.status_code"] != nil and (not IsInt(attributes["http.response.status_code"]) or attributes["http.response.status_code"] < 100 or attributes["http.response.status_code"] > 599)'
    attribute_rules = [*http_rules,*boss_rules,*state_rules,enum_rule('error.type',errors),status_rule]
    keys = ['http.route','http.request.method','http.request.outcome','http.response.status_code',
        'messaging.system','messaging.destination.name','messaging.operation.name','messaging.operation.type',
        'pgboss.job.state','error.type']
    rabbit = 'attributes["messaging.system"] == '+literal(notification['system'])
    span_attributes = [*http_rules,
        enum_rule('messaging.system', ['pg-boss', notification['system']]),
        only(enum_rule('messaging.destination.name', policy['queues']), 'not ('+rabbit+')'),
        only(enum_rule('messaging.destination.name', [notification['destination']]), rabbit),
        only(enum_rule('messaging.operation.name', policy['operations']), 'not ('+rabbit+')'),
        only(enum_rule('messaging.operation.name', notification['operations']), rabbit),
        *state_rules,enum_rule('error.type', [*errors,notification['error']]),status_rule]
    span_rules = ['keep_keys(attributes, '+literal(keys+['messaging.message.id','pgboss.job.retry_count','messaging.batch.message_count'])+')', *span_attributes,
        'delete_key(attributes, "messaging.message.id") where attributes["messaging.message.id"] != nil and not IsMatch(attributes["messaging.message.id"], "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")']
    for key in ('pgboss.job.retry_count','messaging.batch.message_count'):
        span_rules.append(f'delete_key(attributes, "{key}") where attributes["{key}"] != nil and (not IsInt(attributes["{key}"]) or attributes["{key}"] < 0 or attributes["{key}"] > 1000000)')
    span_rules += [
        'set(trace_state, "")', 'set(status.message, "")', 'set(events, nil)',
        # Keep every link. The pinned VT ingestion boundary removes only its metadata fields.
        'set(name, "operation") where not IsMatch(name, "^(HTTP GET /pilot|queue[.]publish|worker[.]attempt|worker[.]retry|dependency[.]http)$")',
        'set(name, Concat([attributes["http.request.method"], attributes["http.route"]], " ")) where attributes["http.request.method"] != nil and attributes["http.route"] != nil',
        'set(name, Concat([attributes["messaging.operation.name"], attributes["messaging.destination.name"]], " ")) where attributes["messaging.operation.name"] != nil and attributes["messaging.destination.name"] != nil',
    ]
    text = '''// Generated by scripts/observability-pilot/privacy_config.py; candidate, not production rollout.
// Link metadata is removed by the pinned VictoriaTraces ingestion filter, not OTTL.
// OTLP JSON/protobuf remain supported. Raw collector diagnostics are not retained by Docker.
logging {
  level = "error"
}

otelcol.receiver.otlp "pilot" {
  http {
    endpoint = "0.0.0.0:4318"
    include_metadata = false
  }
  output {
    metrics = [otelcol.processor.filter.catalog.input]
    logs = [otelcol.processor.filter.catalog.input]
    traces = [otelcol.processor.filter.catalog.input]
  }
}

otelcol.processor.filter "catalog" {
  error_mode = "propagate"
  metrics {
    metric = ['''+'`not IsMatch(name, '+literal(pattern(policy['metrics']+notification['metrics']))+')`'+''']
  }
  output {
    metrics = [otelcol.processor.transform.privacy.input]
    logs = [otelcol.processor.transform.privacy.input]
    traces = [otelcol.processor.transform.privacy.input]
  }
}

otelcol.processor.transform "privacy" {
  error_mode = "propagate"
'''
    for signal in ('trace','metric','log'):
        text += block(signal, 'resource', resource)+block(signal, 'scope', scope)
    text += block('trace','span',span_rules)
    text += block('metric','metric',['set(description, "")', 'set(unit, "")',
        'set(unit, "s") where IsMatch(name, "duration$")'])
    is_notification = 'IsMatch(metric.name, '+literal(pattern(notification['metrics']))+')'
    point_rules = [only(statement, 'not ('+is_notification+')') for statement in
                   ['keep_keys(attributes, '+literal(keys)+')',*attribute_rules]]
    point_rules.append(only('keep_keys(attributes, ["operation", "outcome"])',is_notification))
    for key, values in (('operation',notification['operations']), ('outcome',notification['outcomes'])):
        point_rules += [only('set(attributes['+literal(key)+'], "_OTHER") where not IsString(attributes['+literal(key)+'])',is_notification),
                        only(enum_rule(key,values),is_notification)]
    text += block('metric','datapoint',[*point_rules, 'set(exemplars, nil)'])
    text += block('log','log',['keep_keys(attributes, [])',
        'set(body, "telemetry.redacted") where not IsString(body) or body != "pilot.known_failure"',
        'set(event_name, "")', 'set(severity_text, "")'])
    text += '''  output {
    metrics = [otelcol.exporter.otlphttp.metrics.input]
    logs = [otelcol.exporter.otlphttp.logs.input]
    traces = [otelcol.exporter.otlphttp.traces.input]
  }
}
'''
    for signal, endpoint in (('metrics','http://metrics:8428/opentelemetry'),
                             ('logs','http://logs:9428/insert/opentelemetry'),
                             ('traces','http://traces:10428/insert/opentelemetry')):
        # VT0.12 -> embedded VL c945d2949e98 prefix filter, before stored field copies.
        # Trusted static HTTP headers only. Receiver metadata cannot override this map.
        headers = ('    headers = {"VT-Ignore-Fields" = "link:link_attr:*,link:link_trace_state:*"}\n'
                   if signal == 'traces' else '')
        text += '\notelcol.exporter.otlphttp '+literal(signal)+''' {
  client {
    endpoint = '''+literal(endpoint)+'\n'+headers+'''    timeout = "5s"
  }
  sending_queue {
    queue_size = 64
    num_consumers = 1
  }
  retry_on_failure {
    max_elapsed_time = "30s"
  }
}
'''
    text += '''
// Raw diagnostics are discarded; retain a closed operational health/counter surface instead.
prometheus.scrape "collector_health" {
  targets = [{"__address__" = "127.0.0.1:12345"}]
  scrape_interval = "5s"
  scrape_timeout = "2s"
  body_size_limit = "1MiB"
  sample_limit = 2000
  forward_to = [prometheus.relabel.collector_health.receiver]
}
prometheus.relabel "collector_health" {
  forward_to = [prometheus.remote_write.collector_health.receiver]
  rule {
    source_labels = ["__name__"]
    regex = "up|otelcol_receiver_(accepted|refused)_(spans|metric_points|log_records)(_total)?|otelcol_exporter_(sent|send_failed|enqueue_failed)_(spans|metric_points|log_records)(_total)?|otelcol_exporter_queue_(size|capacity)"
    action = "keep"
  }
  rule {
    source_labels = ["receiver"]
    regex = "(|otlp|otlp/pilot|(otlp/)?otelcol[.]receiver[.]otlp[.]pilot)"
    action = "keep"
  }
  rule {
    source_labels = ["exporter"]
    regex = "(|otlphttp|otlphttp/(metrics|logs|traces)|(otlp_http/)?otelcol[.]exporter[.]otlphttp[.](metrics|logs|traces))"
    action = "keep"
  }
  rule {
    source_labels = ["data_type"]
    regex = "(|traces|metrics|logs)"
    action = "keep"
  }
  rule {
    target_label = "job"
    replacement = "platform-collector"
  }
  rule {
    target_label = "instance"
    replacement = "pilot"
  }
  rule {
    regex = "__name__|job|instance|receiver|exporter|data_type"
    action = "labelkeep"
  }
}
prometheus.remote_write "collector_health" {
  endpoint {
    url = "http://metrics:8428/api/v1/write"
  }
}
'''
    # Only exact pinned VT ingestion counters; arbitrary labels/paths never leave this scrape.
    text += '''
prometheus.scrape "trace_store_health" {
  targets = [{"__address__" = "traces:10428"}]
  scrape_interval = "5s"
  scrape_timeout = "2s"
  body_size_limit = "1MiB"
  sample_limit = 2000
  forward_to = [prometheus.relabel.trace_store_health.receiver]
}
prometheus.relabel "trace_store_health" {
  forward_to = [prometheus.remote_write.collector_health.receiver]
  rule {
    source_labels = ["__name__"]
    regex = "'''+ '|'.join(TRACE_STORE_METRICS)+'''"
    action = "keep"
  }
  rule {
    source_labels = ["path"]
    regex = "(|/insert/opentelemetry/v1/traces)"
    action = "keep"
  }
  rule {
    source_labels = ["format"]
    regex = "(|protobuf)"
    action = "keep"
  }
  rule {
    source_labels = ["type"]
    regex = "(|opentelemetry_traces_otlphttp_protobuf)"
    action = "keep"
  }
  rule {
    source_labels = ["reason"]
    regex = "(|debug|too_many_fields)"
    action = "keep"
  }
  rule {
    target_label = "job"
    replacement = "platform-trace-store"
  }
  rule {
    target_label = "instance"
    replacement = "pilot"
  }
  rule {
    regex = "__name__|job|instance|path|format|type|reason"
    action = "labelkeep"
  }
}
'''
    return text


if __name__ == '__main__':
    result = render()
    if '--check' in sys.argv:
        if (CONFIG/'config.alloy').read_text() != result:
            raise SystemExit('Alloy privacy configuration is stale')
    else:
        (CONFIG/'config.alloy').write_text(result)
