var mosca = require('mosca');
var iotalib = require('dojot-iotagent');

var iota = new iotalib.IoTAgent();
iota.init();

var mosca_backend = {
  type: 'redis',
  redis: require('redis'),
  db: 12,
  port: 6379,
  return_buffers: true, // to handle binary payloads
  host: "mosca-redis"
};

var moscaSettings = {
  port: 1883,
  backend: mosca_backend,
  persistence: {
    factory: mosca.persistence.Redis,
    host: 'mosca-redis'
  }
};

var server = new mosca.Server(moscaSettings);
server.on('ready', setup);

server.on('clientConnected', function(client) {
  // console.log('client up', client.id, client.user, client.passwd);
  // TODO notify dojot that device is online
  // what about pings?
});

server.on('clientDisconnected', function(client) {
  // console.log('client down', client.id, client.user, client.passwd);
  // TODO notify dojot that device is offline
  // what about pings?
});

function parseClient(packet, client) {
  function fromString(clientid) {
    if (clientid && (typeof clientid == 'string')){
      let data = clientid.match(/^(.*):(.*)$/);
      if (data) {
        return { tenant: data[1], device: data[2] };
      }
    }
  }

  function validate(idInfo) {
    return new Promise((resolve, reject) => {
      iota.getDevice(idInfo.device, idInfo.tenant).then((device) => {
        resolve(idInfo, device);
      }).catch((error) => {
        reject(new Error("Unknown device"));
      })
    });
  }

  let result;
  if (client.user !== undefined) {
    console.log('will use client.user as id source');
    result = fromString(client.user);
    if (result)
      return validate(result);
  }

  if (client.id !== undefined) {
    console.log('will use client.id as id source');
    result = fromString(client.id);
    if (result)
      return validate(result);
  }

  // If we're here, it means that neither clientid nor username has been
  // properly set, so fallback to topic-based id scheme
  result = packet.topic.match(/^\/([^/]+)\/([^/]+)/)
  if (result){
    console.log('will use topic as id source');
    return validate({tenant: result[1], device: result[2]});
  }
}

// fired when a message is received
server.on('published', function(packet, client) {

  // ignore meta (internal) topics
  if ((packet.topic.split('/')[0] == '$SYS') || (client === undefined)) {
    return;
  }

  parseClient(packet, client).then((idInfo, device) => {
    let data = packet.payload.toString();
    try {
      data = JSON.parse(data);
      console.log('Published', packet.topic, data, client.id, client.user, client.passwd ? client.passwd.toString() : 'undefined');
      iota.updateAttrs(idInfo.device, idInfo.tenant, data, {});
    } catch (e) {
      console.log('Payload is not valid json. Ignoring.', data, e);
    }
  }).catch((error) => {
    console.error("Failed to identify device which originated the event. Ignoring. (clientid: %s, username: %s, topic: %s)", client.id, client.user, packet.topic);
  })
});

// fired when the mqtt server is ready
function setup() {
  console.log('Mosca server is up and running');

  server.authenticate = (client, username, password, callback) => {
    console.log('will handle authentication request', username, password, client.id);
    // TODO: check if given credentials are valid against cache
    client.user = username;
    client.passwd = password;
    callback(null, true);
  }
}
