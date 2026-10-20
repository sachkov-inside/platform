"""Immutable pre-observation call contracts from accepted727134cf; parsed, never executed."""

def smoke(token, output, compose):
    # Gate the original accessible-field sentinel corpus too, before its first unsafe POST.
    verify_trace_store_logging(output, compose)
    query = "/metrics/api/v1/query?" + urllib.parse.urlencode({"query": "1"})
    await_fact(lambda: request(query, token=token), lambda response: response[0] == 200,
               probe="metrics_query", output=output)
    failures = []
    for prefix, path in [
        ("metrics", "/api/v1/import"), ("metrics", "/api/v1/admin/tsdb/delete_series"),
        ("metrics", "/-/reload"), ("metrics", "/snapshot/create"),
        ("logs", "/insert/jsonline"), ("logs", "/internal/force_merge"),
        ("traces", "/insert/opentelemetry/v1/traces"), ("traces", "/internal/force_merge"),
        ("", "/-/reload"), ("", "/metrics"), ("", "/api/admin"),
        ("metrics", "/api/v1/query/../../admin/tsdb/delete_series"),
        ("metrics", "/api/v1/query/%2e%2e/%2e%2e/admin/tsdb/delete_series"),
        ("logs", "//insert/jsonline"), ("traces", "/%69nsert/opentelemetry/v1/traces"),
    ]:
        for method in ("GET", "POST", "DELETE", "PUT", "PATCH"):
            status, _ = request(("/" + prefix if prefix else "") + path, token=token, method=method)
            if status not in (400, 401, 403, 404, 405):
                failures.append({"method": method, "path": prefix + path, "status": status})
    for method in ("DELETE", "PUT", "PATCH", "OPTIONS"):
        if request(query, token=token, method=method)[0] != 403:
            failures.append({"method": method, "path": "query", "status": "method not denied"})
    if request(query)[0] != 401 or request(query, token="invalid")[0] != 401:
        failures.append({"auth": "absent or invalid key accepted"})
    if failures:
        write_json(output / "negative-failures.json", failures)
        raise RuntimeError("read-only negative probes failed")

    timings = []
    await_otlp_ready(output=output)
    offset = 0
    for phase, count in (("idle", 0), ("steady", 10), ("spike", 50)):
        phase_start = time.monotonic()
        for sequence in range(count):
            fixture = corpus(now_ns=time.time_ns(), sequence=offset + sequence)
            for name, payload in fixture.items():
                status, _ = request("/v1/" + name, body=payload, method="POST", port=14318)
                if status != 200:
                    raise RuntimeError(f"OTLP {name} ingest rejected: {status}")
            # Query competes with ingestion during steady and spike.
            started = time.monotonic()
            status, _ = request(query, token=token)
            if status != 200:
                raise RuntimeError("query unavailable during ingestion")
            timings.append({"phase": phase, "query_seconds": time.monotonic() - started})
        snapshot = command(["docker", "stats", "--no-stream", "--format", "{{json .}}",
                            *command(compose + ["ps", "-q"]).split()])
        (output / f"stats-{phase}.jsonl").write_text(snapshot)
        write_json(output / f"phase-{phase}.json", {
            "duration_seconds": time.monotonic() - phase_start, "fixture_chains": count,
            "note": "short functional smoke; not the accepted steady-state resource corpus",
        })
        offset += count
    checks = [
        ("/metrics/api/v1/query?" + urllib.parse.urlencode({"query": "pilot_requests"}), "pilot_requests"),
        ("/logs/select/logsql/query?" + urllib.parse.urlencode({"query": "_time:5m", "limit": 10}), "pilot.known_failure"),
        ("/traces/select/jaeger/api/traces/00000000000000000000000000000001", "worker.retry"),
    ]
    for index, (path, marker) in enumerate(checks):
        response = await_fact(lambda p=path: request(p, token=token),
                   lambda response, m=marker: response[0] == 200 and m in response[1],
                   probe=("metrics_fixture", "logs_fixture", "traces_fixture")[index], output=output)
        collector_privacy.assert_clean(response[1])
        if index == 2:
            collector_privacy.assert_link_preserved(response[1])
    # Read all records/series in this bounded disposable corpus, not only the positive marker.
    for path in ('/logs/select/logsql/query?'+urllib.parse.urlencode({'query':'_time:1h', 'limit':200}),
                 '/metrics/api/v1/query?'+urllib.parse.urlencode({'query':'{__name__=~".+"}'})):
        status, body = request(path, token=token)
        if status != 200:
            raise RuntimeError('collector privacy storage corpus query failed')
        collector_privacy.assert_clean(body)
    up_path = '/metrics/api/v1/query?'+urllib.parse.urlencode({'query':'up{job="platform-collector"}'})
    health = await_fact(lambda: request(up_path, token=token),
        collector_privacy.healthy,
        probe='collector_safe_health', output=output)
    collector_privacy.assert_clean(health[1])
    counter_path = '/metrics/api/v1/query?'+urllib.parse.urlencode({
        'query':'sum({__name__=~"otelcol_receiver_accepted_spans(_total)?",job="platform-collector"})'})
    counters = await_fact(lambda: request(counter_path, token=token),
        collector_privacy.accepted_counter, probe='collector_safe_acceptance_counter', output=output)
    collector_privacy.assert_clean(counters[1])
    # Pin every configured exporter and signal; a different/unknown exporter cannot satisfy proof.
    for kind, suffix in (('traces', 'spans'), ('logs', 'log_records'), ('metrics', 'metric_points')):
        exported_path = '/metrics/api/v1/query?'+urllib.parse.urlencode({
            'query': 'sum({__name__=~"otelcol_exporter_sent_'+suffix+'(_total)?",'
                     'job="platform-collector",exporter="otlp_http/otelcol.exporter.otlphttp.'+kind+'"})'})
        exported = await_fact(lambda p=exported_path: request(p, token=token),
            collector_privacy.accepted_counter, probe='collector_safe_exported_'+kind, output=output)
        collector_privacy.assert_clean(exported[1])
    write_json(output/'collector-privacy.json', {'accessible_field_sentinel':'passed',
        'safe_link_correlation':'passed', 'safe_collector_health':'passed',
        'safe_collector_acceptance_counter':'passed',
        'safe_collector_export_counters':{'traces':'passed','logs':'passed','metrics':'passed'},
        'collector_raw_diagnostics':'discarded by Docker logging none; not collected',
        'untrusted_link_metadata':'separate JSON/protobuf full-storage gate; production/general-source acceptance pending',
        'source':'synthetic SDK-shaped links; actual SDK wire path is separate evidence'})
    link_privacy_corpus(output, compose)
    notification_catalog_corpus(token,output,compose)
    dependency_catalog_corpus(token,output,compose)
    email_catalog_corpus(token,output,compose)
    telegram_runtime_catalog_corpus(token,output,compose)
    trace_store_surface(token, output)
    native = native_probes(token, output)
    write_json(output / "native-mcp.json", native)
    post_path = "/metrics/api/v1/query"
    # Prometheus read POST uses form data; query in URL is also accepted by its API.
    if request(post_path + "?query=1", token=token, method="POST")[0] != 200:
        raise RuntimeError("required read POST failed")
    command(compose + ["restart", "alloy"])
    await_otlp_ready(output=output, probe="restarted_alloy_otlp")
    restarted = corpus(now_ns=time.time_ns(), sequence=100)["traces"]
    if request("/v1/traces", body=restarted, method="POST", port=14318)[0] != 200:
        raise RuntimeError("restarted collector rejected its unique trace fixture")
    await_stored_trace(token, f"{101:032x}", output=output)
    # Rotate the disposable fixture key and prove the original key no longer works.
    new_token = secrets.token_urlsafe(32)
    write_json(output / "auth.json", auth_config(new_token))
    command(compose + ["restart", "vmauth"])
    await_fact(lambda: request(query, token=new_token), lambda response: response[0] == 200,
               probe="replacement_key_query", output=output)
    if request(query, token=token)[0] != 401:
        raise RuntimeError("revoked fixture key still accepted")
    write_json(output / "query-timings.json", timings)
    return {"query_ingest_auth_revocation": "passed", "native_mcp": native,
            "resource_acceptance": "pending", "application_sdk_propagation": "pending"}

def run_worker(output):
    owner = json.loads((output / "owner.json").read_text())
    if owner["supervisor_pid"] != os.getppid():
        raise RuntimeError("pilot worker requires its registered external supervisor")
    compose = ["docker", "compose", "-p", owner["project"], "-f", str(output / "compose.json")]
    token = json.loads((output / "auth.json").read_text())["users"][0]["bearer_token"]
    mac = owner.get('orbstack')
    guard = worker_storage_guard(owner, compose, output)
    with guard:
        install_plugin(output)
        command(compose + ["config", "--quiet"])
        command(compose + ["up", "-d"], timeout=ACQUISITION_TIMEOUT_SECONDS)
        result = smoke(token, output, compose)
        import source_status_scenario
        auth_owner = (output / 'auth.json').stat()
        images = json.loads((CONFIG / 'inputs.lock.json').read_text())['images']
        plan = compose_plan(CONFIG, output, images, credential_owner=(auth_owner.st_uid, auth_owner.st_gid))
        freshness = source_status_scenario.run(output, compose, plan, command=command, assert_identity=assert_docker_identity)
        result['source_freshness'] = 'passed'
        result['source_freshness_duration_seconds'] = freshness['duration_seconds']
        evidence = json.loads((output / "evidence.json").read_text())
        evidence.update(result)
        if mac:
            evidence['missing'].remove('Mac native MCP execution')
            if native_cpu.has_measurements(result.get('native_mcp'), ('mcp-victoriametrics', 'mcp-victorialogs', 'mcp-victoriatraces')):
                evidence['missing'].remove('Mac native MCP CPU measurement')
        evidence["status"] = "core smoke passed; full pilot acceptance pending"
        write_json(output / "evidence.json", evidence)
