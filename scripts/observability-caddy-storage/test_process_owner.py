"""The outer launcher owns the RPC helper, native child and acquired socket."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]


_WITNESS_CATEGORIES=('none','ownership','remaining','rescue','cleanup','unknown')
_WITNESS_ROLES=('none','child','helper','python','unknown')
_WITNESS_CHECKPOINTS=('unknown','launcher_poll','launcher_terminate','launcher_wait',
    'launcher_kill','launcher_reap','rescue_enter','rescue_group',
    'rescue_term_member','rescue_term_signal','rescue_term_wait',
    'rescue_kill_member','rescue_kill_signal','rescue_kill_wait',
    'rescue_final_member','rescue_remaining','socket_create','socket_option','socket_bind','socket_close')
_WITNESS_UNKNOWN=('unknown','unknown','unknown')


def _witness_admitted(value):
    return (type(value) is tuple and len(value)==3 and all(type(part) is str for part in value)
        and value[0] in _WITNESS_CATEGORIES and value[1] in _WITNESS_CHECKPOINTS and value[2] in _WITNESS_ROLES)


class _CleanupWitness:
    __slots__=('last','failure')
    def __init__(self):self.last=('none','unknown','none');self.failure=None

    def observe(self,checkpoint,role,category):
        if self.failure is not None:return
        if category is None:
            candidate=('none',checkpoint,role)
            if _witness_admitted(candidate):self.last=candidate
        elif type(category) is str and category in _WITNESS_CATEGORIES and category!='none':
            last=self.last if _witness_admitted(self.last) else _WITNESS_UNKNOWN
            self.failure=(category,last[1],last[2])

    def snapshot(self):
        value=self.last if self.failure is None else self.failure
        return value if _witness_admitted(value) else _WITNESS_UNKNOWN


def _witness_event(witness,checkpoint=None,role='none',*,category=None):
    if type(witness) is not _CleanupWitness:return
    active=sys.exc_info()
    try:_CleanupWitness.observe(witness,checkpoint,role,category)
    except BaseException:pass  # Observation cannot replace active cleanup/assertion failures.
    finally:
        if active[1] is not None:BaseException.__traceback__.__set__(active[1],active[2])


def _witness_snapshot(witness):
    if type(witness) is not _CleanupWitness:return _WITNESS_UNKNOWN
    active=sys.exc_info()
    try:
        value=_CleanupWitness.snapshot(witness)
        return value if _witness_admitted(value) else _WITNESS_UNKNOWN
    except BaseException:return _WITNESS_UNKNOWN
    finally:
        if active[1] is not None:BaseException.__traceback__.__set__(active[1],active[2])


def cleanup_launcher(owner,state,*,_witness=None):
    primary=sys.exc_info()[1]
    try:
        try:
            _witness_event(_witness,'launcher_poll')
            if owner.poll() is None:
                _witness_event(_witness,'launcher_terminate');owner.terminate()
            try:
                _witness_event(_witness,'launcher_wait');owner.wait(timeout=6)
            except subprocess.TimeoutExpired:
                _witness_event(_witness,'launcher_kill');owner.kill()
                _witness_event(_witness,'launcher_reap');owner.wait(timeout=3)
        finally:
            # The launcher can already be gone while its registered group still owns a socket.
            if state is not None:
                _witness_event(_witness,'rescue_enter')
                if type(_witness) is _CleanupWitness:rescue_registered(state,_witness=_witness)
                else:rescue_registered(state)
    except Exception:
        _witness_event(_witness,category='cleanup')
        if primary is None:raise
        if hasattr(primary,'add_note'):primary.add_note('closed fixture cleanup failed')
        else:primary.__notes__=[*getattr(primary,'__notes__',[]),'closed fixture cleanup failed']


def rescue_registered(state,*,_witness=None):
    category='rescue'
    try:
        _witness_event(_witness,'rescue_group')
        group=state['python']
        if type(group) is not int or group<=1 or group==os.getpgrp():
            category='ownership';raise ValueError('closed fixture ownership')
        def members(checkpoint):
            nonlocal category
            live=[]
            for name in ('child','helper','python'):
                _witness_event(_witness,checkpoint,name)
                pid=state[name]
                if type(pid) is not int or pid<=1:
                    category='ownership';raise ValueError('closed fixture ownership')
                try:
                    if os.getpgid(pid)!=group:
                        category='ownership';raise ValueError('closed fixture ownership')
                    live.append(pid)
                except ProcessLookupError:pass
            return live
        for signum in (signal.SIGTERM,signal.SIGKILL):
            checkpoint='rescue_term_member' if signum==signal.SIGTERM else 'rescue_kill_member'
            if not members(checkpoint):break
            _witness_event(_witness,'rescue_term_signal' if signum==signal.SIGTERM else 'rescue_kill_signal')
            try:os.killpg(group,signum)
            except ProcessLookupError:pass
            _witness_event(_witness,'rescue_term_wait' if signum==signal.SIGTERM else 'rescue_kill_wait')
            deadline=time.monotonic()+3
            while members(checkpoint) and time.monotonic()<deadline:time.sleep(.01)
        if members('rescue_final_member'):
            _witness_event(_witness,'rescue_remaining')
            category='remaining';raise RuntimeError('closed fixture cleanup deadline')
        _witness_event(_witness,'socket_create')
        with socket.socket() as probe:
            _witness_event(_witness,'socket_option');probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            _witness_event(_witness,'socket_bind');probe.bind(('127.0.0.1',state['port']))
            _witness_event(_witness,'socket_close')
    except BaseException:
        _witness_event(_witness,category=category)
        raise


class OutsideOwner(unittest.TestCase):
    def test_success_failure_timeout_and_interruption_reap_acquired_native_socket(self):
        for protocol,case in ((protocol,case) for protocol in ('--fixture','--held-fixture') for case in ('success','failure','timeout','interruption')):
            with self.subTest(protocol=protocol,case=case),tempfile.TemporaryDirectory() as directory:
                report=Path(directory)/'owner.json';state=None
                owner=subprocess.Popen(['node','scripts/observability-caddy-storage/contract-runner.mjs',protocol,case,str(report)],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                try:
                    deadline=time.monotonic()+4
                    while not report.exists():
                        if owner.poll() is not None or time.monotonic()>=deadline:self.fail('owned fixture never acquired socket')
                        time.sleep(.01)
                    state=json.loads(report.read_text())
                    if case=='interruption':
                        with socket.create_connection(('127.0.0.1',state['port']),timeout=1):pass
                        owner.terminate()
                    self.assertEqual(owner.wait(timeout=7),0 if case=='success' else 1)
                    for name in ('child','helper','python'):
                        with self.assertRaises(ProcessLookupError):os.kill(state[name],0)
                    with socket.socket() as probe:
                        probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
                        probe.bind(('127.0.0.1',state['port']))
                finally:
                    cleanup_launcher(owner,state)

    def test_early_exited_launcher_does_not_skip_registered_group_cleanup_or_mask_assertion(self):
        for protocol in ('--fixture','--held-fixture'):
            with self.subTest(protocol=protocol),tempfile.TemporaryDirectory() as directory:
                report=Path(directory)/'owner.json';state=None
                owner=subprocess.Popen(['node','scripts/observability-caddy-storage/contract-runner.mjs',protocol,'early_exit',str(report)],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                primary=AssertionError('owned early launcher failure');witness=_CleanupWitness()
                try:
                    deadline=time.monotonic()+4
                    while not report.exists():
                        if owner.poll() is not None or time.monotonic()>=deadline:self.fail('owned fixture never acquired socket')
                        time.sleep(.01)
                    state=json.loads(report.read_text())
                    self.assertEqual(int(subprocess.check_output(['ps','-o','ppid=','-p',str(state['python'])],text=True)),owner.pid)
                    self.assertEqual(os.getpgid(state['child']),state['python'])
                    owner.kill();self.assertEqual(owner.wait(timeout=3),-signal.SIGKILL)
                    os.kill(state['child'],0)
                    with self.assertRaises(AssertionError) as caught:
                        try:raise primary
                        finally:cleanup_launcher(owner,state,_witness=witness)
                    self.assertIs(caught.exception,primary)
                    for name in ('child','helper','python'):
                        category,checkpoint,role=_witness_snapshot(witness)
                        with self.assertRaises(ProcessLookupError,
                                msg='cleanup role='+name+' category='+category+' checkpoint='+checkpoint+' witness_role='+role):
                            os.kill(state[name],0)
                    with socket.socket() as probe:
                        probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);probe.bind(('127.0.0.1',state['port']))
                finally:
                    cleanup_launcher(owner,state,_witness=witness)

    def test_outer_rescue_failure_reaps_launcher_and_preserves_primary_or_remains_visible(self):
        _witness_controls(self)
        actual_popen=subprocess.Popen;actual_rescue=rescue_registered
        for has_primary in (True,False):
            with self.subTest(primary=has_primary):
                launchers=[];states=[];calls=0
                primary=AssertionError('owned original assertion')
                cleanup_error=RuntimeError('controlled cleanup refusal')
                class ControlledAssertion(OutsideOwner):
                    def assertEqual(self,*args,**kwargs):
                        if has_primary:raise primary
                        return super().assertEqual(*args,**kwargs)
                def launch(*args,**kwargs):
                    process=actual_popen(*args,**kwargs)
                    if args[0][0]=='node':launchers.append(process)
                    return process
                def rescue(state,*,_witness=None):
                    nonlocal calls
                    calls+=1;states.append(state)
                    if has_primary or calls==2:raise cleanup_error
                    return actual_rescue(state,_witness=_witness)
                try:
                    with patch.object(subprocess,'Popen',side_effect=launch),patch(__name__+'.rescue_registered',side_effect=rescue):
                        try:ControlledAssertion().test_early_exited_launcher_does_not_skip_registered_group_cleanup_or_mask_assertion()
                        except BaseException as error:caught=error
                        else:self.fail('cleanup refusal unexpectedly passed')
                    self.assertIs(caught,primary if has_primary else cleanup_error)
                    self.assertEqual(len(launchers),1)
                    self.assertIsNotNone(launchers[0].poll())
                    if has_primary:self.assertEqual(primary.__notes__,['closed fixture cleanup failed'])
                    for state in states:
                        for name in ('child','helper','python'):
                            with self.assertRaises(ProcessLookupError):os.kill(state[name],0)
                        with socket.socket() as probe:
                            probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);probe.bind(('127.0.0.1',state['port']))
                finally:
                    for owner in launchers:
                        cleanup_launcher(owner,states[0] if states else None)


def _witness_controls(case):
    """Synthetic existing cleanup seams only; never evidence of actual PID/socket absence."""
    from contextlib import ExitStack
    from unittest.mock import Mock
    class Foreign:
        def __getattribute__(self,name):raise AssertionError('foreign witness inspected')
        def __eq__(self,other):raise AssertionError('foreign witness compared')
        def __hash__(self):raise AssertionError('foreign witness hashed')
        def __repr__(self):raise AssertionError('foreign witness represented')
    state={'python':41001,'helper':41002,'child':41003,'port':41004}
    expected=[('poll',),('wait',6),('pgrp',),
              ('pgid','child'),('pgid','helper'),('pgid','python'),
              ('pgid','child'),('pgid','helper'),('pgid','python'),
              ('socket',),('option',),('bind',),('socket_close',)]
    def absent(witness,escalation=False):
        trace=[];roles={pid:role for role,pid in state.items() if role!='port'}
        owner=Mock();owner.poll.side_effect=lambda:trace.append(('poll',)) or (None if escalation else 0)
        owner.terminate.side_effect=lambda:trace.append(('terminate',))
        owner.kill.side_effect=lambda:trace.append(('launcher_kill',))
        def wait(timeout):
            trace.append(('wait',timeout))
            if escalation and timeout==6:raise subprocess.TimeoutExpired('owned-fixture',6)
            return 0
        owner.wait.side_effect=wait
        def pgid(pid):
            trace.append(('pgid',roles[pid]));raise ProcessLookupError()
        probe=Mock();probe.__enter__=Mock(return_value=probe)
        probe.__exit__=Mock(side_effect=lambda *_:trace.append(('socket_close',)))
        probe.setsockopt.side_effect=lambda *_:trace.append(('option',))
        probe.bind.side_effect=lambda *_:trace.append(('bind',))
        with ExitStack() as stack:
            for context in (patch.object(os,'getpgrp',side_effect=lambda:trace.append(('pgrp',)) or 42000),
                patch.object(os,'getpgid',side_effect=pgid),
                patch.object(os,'killpg',side_effect=AssertionError('unexpected signal')),
                patch.object(time,'monotonic',side_effect=AssertionError('unexpected clock')),
                patch.object(time,'sleep',side_effect=AssertionError('unexpected sleep')),
                patch.object(socket,'socket',side_effect=lambda:trace.append(('socket',)) or probe)):
                stack.enter_context(context)
            cleanup_launcher(owner,state,_witness=witness)
        case.assertEqual(trace,([('poll',),('terminate',),('wait',6),('launcher_kill',),('wait',3)]+expected[2:]) if escalation else expected)
    absent(None);absent(Foreign())
    for value in (None,Foreign(),_CleanupWitness()):absent(value,escalation=True)
    witness=_CleanupWitness();absent(witness)
    case.assertEqual(_witness_snapshot(witness),('none','socket_close','none'))
    # Admission of diagnostic state is finite; foreign objects never supply fields.
    first=_witness_snapshot(witness)
    for checkpoint,role,category in (('private-canary','child',None),('rescue_group',Foreign(),None),
                                     (None,None,Foreign())):
        _witness_event(witness,checkpoint,role,category=category)
        case.assertEqual(_witness_snapshot(witness),first)
    witness.last=(Foreign(),'private-canary','child')
    case.assertEqual(_witness_snapshot(witness),_WITNESS_UNKNOWN)
    case.assertEqual(_witness_snapshot(Foreign()),_WITNESS_UNKNOWN)
    for poisoned in (Foreign(),('none','private-canary','child'),('none','socket_close',Foreign()),
                     ['none','socket_close','child']):
        with patch.object(_CleanupWitness,'snapshot',return_value=poisoned):
            case.assertTrue(_witness_snapshot(witness) is _WITNESS_UNKNOWN)

    # Every state/PID/clock/socket operation below is an existing external seam double.
    def refusal(kind,witness,primary=None):
        trace=[];ticks=0
        owner=Mock();owner.poll.side_effect=lambda:trace.append(('poll',)) or 0
        owner.wait.side_effect=lambda timeout:trace.append(('wait',timeout)) or 0
        private=OSError('private-canary')
        roles={pid:role for role,pid in state.items() if role!='port'}
        def pgid(pid):
            trace.append(('pgid',roles[pid]))
            if kind=='foreign':return 42000
            if kind=='unknown':raise private
            return state['python']
        def clock():
            nonlocal ticks
            ticks+=4;trace.append(('clock',));return ticks
        with ExitStack() as stack:
            for context in (patch.object(os,'getpgrp',side_effect=lambda:trace.append(('pgrp',)) or 42000),
                patch.object(os,'getpgid',side_effect=pgid),
                patch.object(os,'killpg',side_effect=lambda _,sig:trace.append(('signal',sig))),
                patch.object(time,'monotonic',side_effect=clock),
                patch.object(time,'sleep',side_effect=AssertionError('unexpected sleep')),
                patch.object(socket,'socket',side_effect=AssertionError('unexpected socket'))):
                stack.enter_context(context)
            if primary is None:
                try:cleanup_launcher(owner,state,_witness=witness)
                except BaseException as error:caught=error
                else:case.fail('original cleanup refusal hidden')
            else:
                try:raise primary
                except BaseException:
                    before=sys.exc_info()[2]
                    cleanup_launcher(owner,state,_witness=witness)
                    case.assertIs(BaseException.__traceback__.__get__(primary),before)
                    caught=primary
        if primary is None and kind=='unknown':case.assertIs(caught,private)
        if primary is not None:case.assertEqual(primary.__notes__,['closed fixture cleanup failed'])
        return caught,trace
    for kind,expected_record in (('foreign',('ownership','rescue_term_member','child')),
                                ('unknown',('rescue','rescue_term_member','child')),
                                ('remaining',('remaining','rescue_remaining','none'))):
        for has_primary in (False,True):
            witness=_CleanupWitness();primary=AssertionError('owned primary') if has_primary else None
            error,trace=refusal(kind,witness,primary)
            case.assertEqual(_witness_snapshot(witness),expected_record)
            if primary is not None:case.assertIs(error,primary)
            if kind=='remaining':
                expected_trace=[('poll',),('wait',6),('pgrp',)]
                for sig in (signal.SIGTERM,signal.SIGKILL):
                    expected_trace.extend([('pgid','child'),('pgid','helper'),('pgid','python'),
                                           ('signal',sig),('clock',),('pgid','child'),('pgid','helper'),('pgid','python'),('clock',)])
                expected_trace.extend([('pgid','child'),('pgid','helper'),('pgid','python')])
                case.assertEqual(trace,expected_trace)
            else:case.assertEqual(trace,[('poll',),('wait',6),('pgrp',),('pgid','child')])
            absent(witness)  # The second safety cleanup still executes but cannot overwrite the first failure.
            with patch.object(_CleanupWitness,'observe',side_effect=OSError('private-canary')):absent(witness)
            case.assertEqual(_witness_snapshot(witness),expected_record)
            case.assertNotIn('private-canary',str(_witness_snapshot(witness)))

    # Secondary observer faults cannot replace or mutate the active primary traceback.
    for primary in (AssertionError('owned primary'),KeyboardInterrupt(),SystemExit()):
        for same in (False,True):
            witness=_CleanupWitness()
            try:raise primary
            except BaseException:
                before=sys.exc_info()[2]
                def fail_observer(*_):
                    if same:raise primary
                    raise RuntimeError('private-canary')
                with patch.object(_CleanupWitness,'observe',side_effect=fail_observer):absent(witness)
                case.assertIs(BaseException.__traceback__.__get__(primary),before)
                with patch.object(_CleanupWitness,'snapshot',side_effect=fail_observer):
                    case.assertEqual(_witness_snapshot(witness),_WITNESS_UNKNOWN)
                case.assertIs(BaseException.__traceback__.__get__(primary),before)
    # Run the actual failing test over external doubles, without any actual PID/ps/socket.
    for fails,snapshot_fault in ((True,False),(False,False),(True,True)):
        trace=[];owners=[];lookups=0;kills=0
        class Directory:
            def __enter__(self):return '/owned-fixture'
            def __exit__(self,*_):pass
        class Owner:
            pid=48000
            def __init__(self):self.status=None
            def poll(self):trace.append(('owner_poll',));return self.status
            def kill(self):trace.append(('owner_kill',));self.status=-signal.SIGKILL
            def wait(self,timeout):trace.append(('owner_wait',timeout));return self.status
        def launch(*_,**__):
            nonlocal lookups,kills
            lookups=0;kills=0;owner=Owner();owners.append(owner);return owner
        roles={pid:role for role,pid in state.items() if role!='port'}
        def pgid(pid):
            nonlocal lookups
            lookups+=1;trace.append(('pgid',roles[pid]))
            if lookups==1:return state['python']  # Original pre-kill ownership assertion.
            if fails:return 42000  # Original foreign-group guard, not a new state read.
            raise ProcessLookupError()
        def kill(pid,sig):
            nonlocal kills
            kills+=1;trace.append(('kill',roles[pid],sig))
            if kills==1 or fails and roles[pid]=='child':return
            raise ProcessLookupError()
        probe=Mock();probe.__enter__=Mock(return_value=probe)
        probe.__exit__=Mock(side_effect=lambda *_:trace.append(('socket_close',)))
        probe.setsockopt.side_effect=lambda *_:trace.append(('option',))
        probe.bind.side_effect=lambda *_:trace.append(('bind',))
        result=unittest.TestResult()
        with ExitStack() as stack:
            for context in (patch.object(tempfile,'TemporaryDirectory',return_value=Directory()),
                patch.object(Path,'exists',return_value=True),patch.object(Path,'read_text',return_value=json.dumps(state)),
                patch.object(subprocess,'Popen',side_effect=launch),
                patch.object(subprocess,'check_output',return_value='48000'),
                patch.object(os,'getpgrp',return_value=42000),patch.object(os,'getpgid',side_effect=pgid),
                patch.object(os,'kill',side_effect=kill),patch.object(os,'killpg',side_effect=AssertionError('unexpected signal')),
                patch.object(time,'monotonic',return_value=0),patch.object(time,'sleep',side_effect=AssertionError('unexpected sleep')),
                patch.object(socket,'socket',side_effect=lambda:trace.append(('socket',)) or probe)):
                stack.enter_context(context)
            if snapshot_fault:stack.enter_context(patch.object(_CleanupWitness,'snapshot',side_effect=RuntimeError('private-canary')))
            OutsideOwner('test_early_exited_launcher_does_not_skip_registered_group_cleanup_or_mask_assertion').run(result)
        case.assertEqual(len(owners),2);case.assertEqual(result.errors,[])
        case.assertEqual(len(result.failures),2 if fails else 0)
        if fails:
            for _,failure in result.failures:
                expected_message=('cleanup role=child category=unknown checkpoint=unknown witness_role=unknown'
                    if snapshot_fault else 'cleanup role=child category=ownership checkpoint=rescue_term_member witness_role=child')
                case.assertIn(expected_message,failure)
                case.assertNotIn('private-canary',failure)
            case.assertFalse(any(item[0]=='socket' for item in trace))
        case.assertEqual([item for item in trace if item[0]=='kill'],
                         [('kill',role,0) for _ in range(2) for role in (('child','child') if fails else ('child','child','helper','python'))])
        case.assertEqual([item for item in trace if item[0]=='owner_wait'],[('owner_wait',3),('owner_wait',6),('owner_wait',6)]*2)
        case.assertEqual(sum(item[0]=='bind' for item in trace),0 if fails else 6)
