"""Live, closed authority projection in addition to Core image/mount/network ownership."""
import caddy_status

FIELDS={'logging','ports','cap_add','cap_drop','security','privileged','read_only','publish_all',
        'pid_mode','ipc_mode','uts_mode','devices','device_requests','device_rules','volumes_from','links','extra_hosts'}
INSPECT='{' + ','.join('"'+name+'":{{json .HostConfig.'+field+'}}' for name,field in (
    ('logging','LogConfig.Type'),('ports','PortBindings'),('cap_add','CapAdd'),('cap_drop','CapDrop'),
    ('security','SecurityOpt'),('privileged','Privileged'),('read_only','ReadonlyRootfs'),
    ('publish_all','PublishAllPorts'),('pid_mode','PidMode'),('ipc_mode','IpcMode'),('uts_mode','UTSMode'),
    ('devices','Devices'),('device_requests','DeviceRequests'),('device_rules','DeviceCgroupRules'),
    ('volumes_from','VolumesFrom'),('links','Links'),('extra_hosts','ExtraHosts'))) + '}'


def refuse():
    raise ValueError('closed Caddy runtime identity refused')


def _capabilities(value):
    if value is None:return set()
    if type(value) is not list or len(value)>16 or any(type(v) is not str for v in value):refuse()
    normalized=[v.removeprefix('CAP_') for v in value]
    if len(set(normalized))!=len(normalized):refuse()
    return set(normalized)


def validate(raw,role,plan):
    try:
        value=caddy_status.source_status.decode_json(raw)
        if type(role) is not str or role not in plan['services'] or type(value) is not dict or set(value)!=FIELDS:refuse()
        service=plan['services'][role]
        if (value['logging']!=service['logging']['driver']
                or value['privileged'] is not False or value['read_only'] is not True
                or value['publish_all'] is not False or value['pid_mode']!='' or value['uts_mode']!=''
                or value['ipc_mode']!='private'
                or any(value[key] not in (None,[]) for key in ('devices','device_requests','device_rules','volumes_from','links','extra_hosts'))
                or value['security']!=['no-new-privileges:true']
                or _capabilities(value['cap_add'])!=set(service.get('cap_add',[]))
                or _capabilities(value['cap_drop'])!={'ALL'}):refuse()
        ports={}
        for publication in service.get('ports',[]):
            host,source,target=publication.split(':')
            ports[target+'/tcp']=[{'HostIp':host,'HostPort':source}]
        if value['ports'] not in (None,{}) if not ports else value['ports']!=ports:refuse()
        return True
    except (ValueError,TypeError,KeyError,AttributeError):refuse()
