const util = require('util');
const auth = require("./auth.json");
const Discord = require("discord.js");
const client = new Discord.Client();
const request = require('request');
const async = require('async');
const mysql = require('mysql');
const express = require("express");
const TwitchWebhook = require('twitch-webhook');
const app = express();
app.use(express.logger());

var connection;

var db_config = {
    'host': auth.host,
    'user': auth.user,
    'password': auth.password,
    'database': auth.database
}

function handleDisconnect() {
    console.log('1. connecting to db:');
    connection = mysql.createConnection(db_config); // Recreate the connection, since
    // the old one cannot be reused.

    connection.connect(function (err) {              	// The server is either down
        if (err) {                                     // or restarting (takes a while sometimes).
            console.log('2. error when connecting to db:', err);
            setTimeout(handleDisconnect, 2000); // We introduce a delay before attempting to reconnect,
        }                                     	// to avoid a hot loop, and to allow our node script to
        checkStream();
    });                                     	// process asynchronous requests in the meantime.
    // If you're also serving http, display a 503 error.
    connection.on('error', function (err) {
        console.log('3. db error', err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST') { 	// Connection to the MySQL server is usually
            handleDisconnect();                      	// lost due to either server restart, or a
        } else {                                      	// connnection idle timeout (the wait_timeout
            throw err;                                  // server variable configures this)
        }
    });
}

function checkStream() {
    var results = [];
    var query = connection.query('SELECT * FROM streamers ORDER BY followers DESC', function (error, result, fields) {
        if (error) throw error;
        for (var i = 0; i < result.length; i++) {
            console.log('id : ' + result[i].streamid);
            twitchWebhook.subscribe('streams', {
                user_id: result[i].streamid +''
            })
        }
    });
}
client.on('ready', () => {
    handleDisconnect();
});

client.on('message', msg => {
    if (msg.content === 'ping') {
        msg.reply('Pong!');
    }
    else if (msg.content.startsWith('!streamer add')) {
        var myRole = msg.guild.roles.find("name", "g");
        var tmpArr = msg.content.split(' ');
        if(msg.member.roles.has(myRole.id)) {
            var options = {
                url: 'https://api.twitch.tv/kraken/users?login=' + tmpArr[2],
                headers: {
                    'Accept': 'application/vnd.twitchtv.v5+json',
                    'Client-ID': auth.twitch_key
                }
            };
            request(options, (err, res, body) => {
                if (err) { return console.log(err); }
                var result = JSON.parse(body);
                if (result['_total'] == '0') {
                    msg.reply('해당하는 스트리머가 없습니다.');
                }
                else {
                    var secondOptions = {
                        url: 'https://api.twitch.tv/kraken/channels/' + result['users'][0]['_id'],
                        headers: {
                            'Accept': 'application/vnd.twitchtv.v5+json',
                            'Client-ID': auth.twitch_key
                        }
                    };
                    var thirdOptions = {
                        url: 'https://api.twitch.tv/kraken/streams/' + result['users'][0]['_id'],
                        headers: {
                            'Accept': 'application/vnd.twitchtv.v5+json',
                            'Client-ID': auth.twitch_key
                        }
                    };
                    var tasks = [
                        function (callback) {
                            request(secondOptions, (err, res, body) => {
                                if (err) { return console.log(err); }
                                var channelResult = JSON.parse(body);
                                callback(null, channelResult);
                            })
                        },
                        function (callback) {
                            request(thirdOptions, (err, res, body) => {
                                if (err) { return console.log(err); }
                                var streamResult = JSON.parse(body);
                                callback(null, streamResult);
                            })
                        }
    
                    ];
                    async.series(tasks, function (err, r) {
                        console.log('finish');
                        restime = new Date();
                        console.log(r);
                        var post = {
                            streamid: result['users'][0]['_id'],
                            streamname: tmpArr[2],
                            res_dt: connection.escape(restime),
                            followers: r[0]['followers'],
                            views: r[0]['views'],
                            is_stream: util.isNullOrUndefined(r[1]['stream']) ? false : true,
                            title: r[0]['status']
                        };
                        var query = connection.query('INSERT INTO streamers SET ?'
                            + 'ON DUPLICATE KEY UPDATE streamid = VALUES(streamid), streamname = VALUES(streamname),res_dt = NOW(),'
                            + 'followers = VALUES(followers),views = VALUES(views),is_stream = VALUES(is_stream),title = VALUES(title)'
                            , post, function (error, results, fields) {
                                if (error) throw error;
                                // Neat!
                                msg.reply('\n' + tmpArr[2] + '님의 추가가 완료되었습니다.');
                            });
                    });
                }
            });
        } else {
            msg.reply('권한이 없습니다.');
        }
        
    }
    else if (msg.content.startsWith('!streamer del')) {
        var tmpArr = msg.content.split(' ');
        var myRole = msg.guild.roles.find("name", "g");
        if(msg.member.roles.has(myRole.id)) {
            var query = connection.query('DELETE FROM streamers where streamname = \'' + tmpArr[2] + '\'', function (error, results, fields) {
                if (error) throw error;
                // Neat!
                msg.reply('\n' + tmpArr[2] + '님의 삭제가 완료되었습니다.');
            });
        } else {
            msg.reply('권한이 없습니다.');
        }
        
    }
    else if (msg.content.startsWith('!streamer list')) {
        var query = connection.query('SELECT * FROM streamers ORDER BY followers DESC', function (error, results, fields) {
            if (error) throw error;
            // Neat!
            console.log(results);
            var str = '';
            str += '현재 총 등록된 스트리머는' + results.length + '명 입니다';
            for (var i = 0; i < results.length; i++) {
                console.log(results[i]);
                str += '\n' + results[i]['streamname'] + '님의 현재 팔로우는'
                    + results[i]['followers'] + '이며 마지막 방송의 제목은 ' + results[i]['title'] + '입니다';

            }
            msg.reply(str);
        });
    }
    else if (msg.content.startsWith('!streamer')) {
        var tmpArr = msg.content.split(' ');
        var options = {
            url: 'https://api.twitch.tv/kraken/users?login=' + tmpArr[1],
            headers: {
                'Accept': 'application/vnd.twitchtv.v5+json',
                'Client-ID': auth.twitch_key
            }
        };
        request(options, (err, res, body) => {
            if (err) { return console.log(err); }
            var result = JSON.parse(body);
            if (result['_total'] == '0') {

            }
            else {
                var str = '\n' + result['users'][0]['display_name'] + "의 방송입니다";
                str += '\nhttps://twitch.tv/' + tmpArr[1];
                console.log(str);
                var secondOptions = {
                    url: 'https://api.twitch.tv/kraken/channels/' + result['users'][0]['_id'],
                    headers: {
                        'Accept': 'application/vnd.twitchtv.v5+json',
                        'Client-ID': auth.twitch_key
                    }
                };
                var thirdOptions = {
                    url: 'https://api.twitch.tv/kraken/streams/' + result['users'][0]['_id'],
                    headers: {
                        'Accept': 'application/vnd.twitchtv.v5+json',
                        'Client-ID': auth.twitch_key
                    }
                };
                var tasks = [
                    function (callback) {
                        request(secondOptions, (err, res, body) => {
                            if (err) { return console.log(err); }
                            var channelResult = JSON.parse(body);
                            str += '\n' + channelResult['followers'] + "명의 팔로워가 있습니다.";
                            console.log(str);
                            callback();
                        })
                    },
                    function (callback) {
                        request(thirdOptions, (err, res, body) => {
                            if (err) { return console.log(err); }
                            var streamResult = JSON.parse(body);
                            if (streamResult['stream'] == null) {
                                str += '\n현재 방송을 하지 않고 있습니다.';
                            }
                            else {
                                str += '\n현재 방송중입니다. 시청자수는 ' + streamResult['stream']['viewers'] + '명입니다.';
                                str += '\n방송 제목은 ' + streamResult['stream']['channel']['status'] + '입니다.';
                                str += '\n현재 진행중인 카테고리는 ' + streamResult['stream']['game'] + '입니다';
                            }
                            console.log(str);
                            callback();
                        })
                    }
                ];
                async.series(tasks, function (err, result) {
                    console.log('finish');
                    msg.reply(str);
                });
            }
        });
    }
});


var port = 3000;

app.get('/streamMessage', (req, res) => {
    client.channels.get('403834322685001728').send('My Message');
})

const twitchWebhook = new TwitchWebhook({
    client_id: auth.twitch_key,
    callback: 'http://whitecloude.com:3000/streamMessage',
    secret: 'false', // default: false
    lease_seconds: 864000,    // default: 864000 (maximum value)
    listen: {
        port: 3000,           // default: 8443
        host: '0.0.0.0',    // default: 0.0.0.0
        autoStart: true      // default: true
    }
})
process.on('SIGINT', () => {
    // unsubscribe from all topics
    twitchWebhook.unsubscribe('*')

    process.exit(0)
})

twitchWebhook.on('streams', ({ topic, options, endpoint, event }) => {
    if (event) {
        eResult = event['data'][0];
        var options = {
            url: 'https://api.twitch.tv/kraken/users?id=' +eResult['user_id'],
            headers: {
                'Accept': 'application/vnd.twitchtv.v5+json',
                'Client-ID': auth.twitch_key
            }
        };

        request(options, (err, res, body) => {
            if (err) { return console.log(err); }
            var result = JSON.parse(body);
            var str = '\n' + result['users'][0]['display_name'] + "의 방송입니다";
            str += '\n현재 방송이 시작되었습니다 ';
            str += '\n방송 제목은 ' + eResult['title'] + '입니다';
            str += '\nhttps://twitch.tv/' + result['users'][0]['name'];
            client.channels.get('403834322685001728').send(str);
        })
    }
})
client.login(auth.db_private_key);