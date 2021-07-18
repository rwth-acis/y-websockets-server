#!/usr/bin/env node
/* global process, global */
'use strict'

var Y = require('yjs')
const fetch = require('node-fetch')

Y.debug.log = console.log.bind(console)

const log = Y.debug('y-websockets-server')
var minimist = require('minimist')
require('y-memory')(Y)
try {
  require('y-leveldb')(Y)
} catch (err) {}

try {
  // try to require local y-websockets-server
  require('./y-websockets-server.js')(Y)
} catch (err) {
  // otherwise require global y-websockets-server
  require('y-websockets-server')(Y)
}

var options = minimist(process.argv.slice(2), {
  string: ['port', 'debug', 'db'],
  default: {
    port: process.env.PORT || '1234',
    debug: false,
    db: 'memory'
  }
})

var port = Number.parseInt(options.port, 10)
var io = require('socket.io')(port)
console.log('Running y-websockets-server on port ' + port)

global.yInstances = {}

function getInstanceOfY (room) {
  if (global.yInstances[room] == null) {
    global.yInstances[room] = Y({
      db: {
        name: options.db,
        dir: 'y-leveldb-databases',
        namespace: room
      },
      connector: {
        name: 'websockets-server',
        room: room,
        io: io,
        debug: !!options.debug
      },
      share: {}
    })
  }
  return global.yInstances[room]
}

io.on('connection', async function (socket) {
  var rooms = []
  socket.on('joinRoom', async function (room, authInfo) {
    if (room.startsWith('projects_')) {
      // we expect the following format: projects_{system}_{projectName}
      var roomNameParts = room.split('_', 3)
      if (roomNameParts.length !== 3) {
        console.error('Room name starts with projects_ but is not well formatted.')
        socket.disconnect()
      } else {
        // extract system name and project name from the room name
        let system = roomNameParts[1]
        let projectName = roomNameParts[2]

        // send GET request to fetch the given project in the given system
        // therefore use the authInfo given by the user (to check if access to project is granted)
        await fetch('{PROJECT_SERVICE_URL}/projects/' + system + '/' + projectName, {
          method: 'GET',
          headers: {
            'access-token': authInfo.accessToken,
            'Authorization': 'Basic ' + authInfo.basicAuth,
            'Content-Type': 'application/json'
          }
        }).then((response) => {
          if (!response.ok) {
            throw new Error('Project service is unavailable or user has no access to project.' + response.status)
          }
          return response
        }).then(async (response) => {
          const data = await response.json()
          const isMember = data.is_member
          if (isMember) {
            // user has access to project
            log('User "%s" joins room "%s"', socket.id, room)
            socket.join(room)
            getInstanceOfY(room).then(function (y) {
              global.y = y // TODO: remove !!!
              if (rooms.indexOf(room) === -1) {
                y.connector.userJoined(socket.id, 'slave')
                rooms.push(room)

                log('Sending join finished message 1')
                y.connector.send(socket.id, {
                    type: 'userJoined called'
                  })
              }
            })
          } else {
            console.log('user is no member')
            // user is no member
            socket.disconnect()
          }
        }).catch((error) => {
          console.error('error fetching project', error)
          // user has no access to project
          socket.disconnect()
        })
      }
    } else {
      // currently: allow other room names to be open for everyone
      log('User "%s" joins room "%s"', socket.id, room)
      socket.join(room)
      getInstanceOfY(room).then(function (y) {
        global.y = y // TODO: remove !!!
        if (rooms.indexOf(room) === -1) {
          y.connector.userJoined(socket.id, 'slave')
          rooms.push(room)

          log('Sending join finished message 2')
          y.connector.send(socket.id, {
              type: 'userJoined called'
            })
        }
      })
    }
  })
  socket.on('yjsEvent', function (msg) {
    if (msg.room != null) {
      getInstanceOfY(msg.room).then(function (y) {
        y.connector.receiveMessage(socket.id, msg)
      })
    }
  })
  socket.on('disconnect', function () {
    for (var i = 0; i < rooms.length; i++) {
      let room = rooms[i]
      getInstanceOfY(room).then(function (y) {
        var i = rooms.indexOf(room)
        if (i >= 0) {
          y.connector.userLeft(socket.id)
          rooms.splice(i, 1)
        }
      })
    }
  })
  socket.on('leaveRoom', function (room) {
    getInstanceOfY(room).then(function (y) {
      var i = rooms.indexOf(room)
      if (i >= 0) {
        y.connector.userLeft(socket.id)
        rooms.splice(i, 1)
      }
    })
  })
})
