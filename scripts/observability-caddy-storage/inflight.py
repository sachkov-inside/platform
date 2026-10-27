"""Independent pre-query native witness plus matching original stored sample cohorts."""
import caddy_status as status
import native_source


def scraped(previous,current,owned_reads):
    """Only Alloy and this single worker read the private srv1/metrics registry.

    Its total counts completed requests. Each next read sees the preceding owned
    read complete, so subtract all of those before proving a foreign scrape.
    """
    if type(owned_reads) is not int or not 1<=owned_reads<=32:status.refuse()
    before=native_source.scrape_registry(previous)
    if before['in_flight']!=1:status.refuse()
    expected=before['requests_total']+owned_reads
    actual=native_source.scrape_registry(current)['requests_total']
    if actual<expected:status.refuse()
    return actual>expected


def validate(*,baseline,raw_held,canonical,mcp,r_received,f_sent):
    start,end=status.clock(r_received),status.clock(f_sent)
    if not start<end or end-start>8:status.refuse()
    before,held=native_source.parse(baseline),native_source.parse(raw_held)
    if before is None or held is None or before['in_flight']!=0 or held['in_flight']!=1:status.refuse()
    maps=[]
    for acquired in (canonical,mcp):
        if type(acquired) is not dict or set(acquired)!={'values','timestamps','evaluated_at','completed_at'}:status.refuse()
        report=status.evaluate(**acquired)
        if (report['state']!='observed' or report['observation']['in_flight']<1
                or not start<status.clock(acquired['completed_at'])
                or acquired['evaluated_at']!=int(end)):status.refuse()
        rows,stamps=status.acquire(**acquired)
        if any(not start<stamp<end for stamp in stamps.values()):status.refuse()
        maps.append((rows,stamps))
    if canonical['evaluated_at']!=mcp['evaluated_at'] or maps[0]!=maps[1]:status.refuse()
    return True
