"""Bounded private request journal; no inference across a scrape-crossing request window."""
from collections import Counter
import caddy_status as status

MAX_WINDOWS=256


class Traffic:
    def __init__(self):
        self._windows=[]

    def record(self,started,completed,method,code,*,count=1):
        start,end=status.clock(started),status.clock(completed)
        if (not start<=end or end-start>10 or method not in status.METHODS
                or type(code) is not int or not 100<=code<=599
                or type(count) is not int or count not in (1,2)
                or count==2 and (method,code)!=('GET',200)
                or len(self._windows)>=MAX_WINDOWS):
            status.refuse()
        self._windows.append((start,end,method,code,count))

    def verify(self,previous,current):
        report=status.evaluate(current['values'],current['timestamps'],evaluated_at=current['evaluated_at'],
            completed_at=current['completed_at'],previous=previous)
        if report['state']=='malformed':status.refuse()
        if report['state']!='observed' or report['comparison']['state']=='incomplete':return None
        if report['comparison']['state']!='observed':status.refuse()
        _,old_stamps=status.acquire(**previous);_,stamps=status.acquire(**current)
        left,right=next(iter(old_stamps.values())),next(iter(stamps.values()))
        expected=Counter()
        for start,end,method,code,count in self._windows:
            if end<left or start>right:continue
            if start<=left<=end or start<=right<=end:return None
            expected[(method,code)]+=count
        actual=Counter({(row['method'],row['code']):row['count_delta'] for row in report['comparison']['duration']})
        if actual!=expected or report['comparison']['requests_delta']!=sum(expected.values()):status.refuse()
        return True
