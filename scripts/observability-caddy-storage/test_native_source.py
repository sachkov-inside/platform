"""Private native exposition is validated before any labels or nested routes are dropped."""
import json
import unittest
import native_source
from test_observation import acquisition


def wire():
    value,_=acquisition();lines=['# TYPE caddy_http_requests_total counter','# TYPE caddy_http_request_errors_total counter','# TYPE caddy_http_requests_in_flight gauge','# TYPE caddy_http_request_duration_seconds histogram']
    for row in value['data']['result'][1:]:
        labels={k:v for k,v in row['metric'].items() if k not in ('__name__','job','instance')}
        lines.append(row['metric']['__name__']+'{'+','.join(k+'='+json.dumps(v) for k,v in labels.items())+'} '+row['value'][1])
    lines.append('caddy_http_requests_total{server="srv0",handler="request_body"} 3')
    lines.append('caddy_http_requests_total{server="srv1",handler="subroute"} 8')
    return ('\n'.join(lines)+'\n').encode()


class BeforeDeletion(unittest.TestCase):
    def test_native_partition_is_counted_once_and_private_excluded_route_labels_still_refuse(self):
        parsed=native_source.parse(wire())
        self.assertEqual(parsed['requests_total'],3)
        self.assertEqual(parsed['in_flight'],1)
        import inflight
        def registry(count):
            return wire()+f'caddy_http_requests_total{{server="srv1",handler="metrics"}} {count}\ncaddy_http_requests_in_flight{{server="srv1",handler="metrics"}} 1\n'.encode()
        self.assertEqual(native_source.scrape_registry(registry(10)),{'requests_total':10,'in_flight':1})
        self.assertFalse(inflight.scraped(registry(10),registry(11),1))
        self.assertTrue(inflight.scraped(registry(10),registry(12),1))
        for current,own in ((10,1),(9,1),(12,True),(50,33)):
            with self.assertRaises(ValueError):inflight.scraped(registry(10),registry(current),own)
        with self.assertRaises(ValueError):native_source.scrape_registry(wire())
        busy=registry(10).replace(b'caddy_http_requests_in_flight{server="srv1",handler="metrics"} 1',b'caddy_http_requests_in_flight{server="srv1",handler="metrics"} 2')
        with self.assertRaises(ValueError):inflight.scraped(busy,registry(12),1)
        poisoned=registry(12)+b'caddy_http_requests_total{server="srv1",handler="metrics",private="bad"} 1\n'
        with self.assertRaises(ValueError):inflight.scraped(registry(10),poisoned,1)

        for extra in (b'private="private-caddy-sentinel"',b'host="unrecognized-host"'):
            poison=wire()+b'caddy_http_requests_total{server="srv1",handler="subroute",'+extra+b'} 1\n'
            with self.assertRaisesRegex(ValueError,'^closed Caddy native source refused$'):native_source.parse(poison)

    def test_excluded_scrape_server_histogram_contradiction_is_checked_before_deletion(self):
        poison=wire()+b'caddy_http_request_duration_seconds_bucket{server="srv1",handler="metrics",method="GET",code="200",le="0.005"} 1\n'+b'caddy_http_request_duration_seconds_bucket{server="srv1",handler="metrics",method="GET",code="200",le="0.01"} 0\n'
        with self.assertRaisesRegex(ValueError,'^closed Caddy native source refused$'):native_source.parse(poison)
