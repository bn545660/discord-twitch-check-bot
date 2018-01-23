const Discord = require("discord.js");
const client = new Discord.Client();
const request = require('request');
const async = require('async');
const mysql = require('mysql');
const express = require("express");
const app = express();
app.use(express.logger());

var db_config = {
    host: 'streamer.ccsfzgkmoc3s.ap-northeast-2.rds.amazonaws.com',
    user: 'WhiteCloude',
    password: '1258963aa!',
    database: 'streamer'
};

var connection;

function handleDisconnect() {
    console.log('1. connecting to db:');
    connection = mysql.createConnection(db_config); // Recreate the connection, since
													// the old one cannot be reused.

    connection.connect(function(err) {              	// The server is either down
        if (err) {                                     // or restarting (takes a while sometimes).
            console.log('2. error when connecting to db:', err);
            setTimeout(handleDisconnect, 2000); // We introduce a delay before attempting to reconnect,
        }                                     	// to avoid a hot loop, and to allow our node script to
    });                                     	// process asynchronous requests in the meantime.
    											// If you're also serving http, display a 503 error.
    connection.on('error', function(err) {
        console.log('3. db error', err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST') { 	// Connection to the MySQL server is usually
            handleDisconnect();                      	// lost due to either server restart, or a
        } else {                                      	// connnection idle timeout (the wait_timeout
            throw err;                                  // server variable configures this)
        }
    });
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  handleDisconnect();
});

client.on('message', msg => {
  if (msg.content === 'ping') {
    msg.reply('Pong!');
  }
  else if (msg.content.startsWith('!streamer add')) {
    msg.reply(msg.content.replace('!streamer add'));
    var tmpArr = msg.content.split(' ');
    var options = {
        url: 'https://api.twitch.tv/kraken/users?login=' + tmpArr[2],
        headers: {
          'Accept': 'application/vnd.twitchtv.v5+json',
          'Client-ID' : process.env.TWITCH_TOKEN
        }
    };
    request(options, (err, res, body) => {
        if (err) { return console.log(err); }
        var result = JSON.parse(body);
        if(result['_total'] == '0'){
            msg.reply('해당하는 스트리머가 없습니다.');            
        }
        else{
            var secondOptions = {
                url: 'https://api.twitch.tv/kraken/channels/' + result['users'][0]['_id'],
                headers: {
                  'Accept': 'application/vnd.twitchtv.v5+json',
                  'Client-ID' : process.env.TWITCH_TOKEN
                }
            };
            var thirdOptions = {
                url: 'https://api.twitch.tv/kraken/streams/' + result['users'][0]['_id'],
                headers: {
                  'Accept': 'application/vnd.twitchtv.v5+json',
                  'Client-ID' :process.env.TWITCH_TOKEN
                }
            };
            var tasks =[
              function(callback){
                request(secondOptions, (err, res ,body) => {
                  if (err) { return console.log(err); }
                  var channelResult = JSON.parse(body);
                  callback(channelResult);
                })
              },
              function(callback){
                request(thirdOptions, (err, res ,body) => {
                  if (err) { return console.log(err); }
                  var streamResult = JSON.parse(body);
                  callback(streamResult);
                })
              }
              
            ];
            async.series(tasks, function(err , r){
                console.log('finish');
                restime = new Date();
                var post  = {
                    streamid: result['users'][0]['_id'],
                    streamName: tmpArr[2],
                    res_dt : connection.escape(restime),
                    followers : r[0]['followers'],
                    views : r[0]['views'],
                    stream : r[1]['stream'] ,
                    title :r[0]['status']                  
                    };
                var query = connection.query('INSERT INTO streamers SET ?', post, function (error, results, fields) {
                    if (error) throw error;
                    // Neat!
                });
            });
        }
      });


  }
  else if (msg.content.startsWith('!streamer')) {
    var tmpArr = msg.content.split(' ');
    var options = {
        url: 'https://api.twitch.tv/kraken/users?login=' + tmpArr[1],
        headers: {
          'Accept': 'application/vnd.twitchtv.v5+json',
          'Client-ID' : process.env.TWITCH_TOKEN
        }
    };
    request(options, (err, res, body) => {
        if (err) { return console.log(err); }
        var result = JSON.parse(body);
        if(result['_total'] == '0'){
            
        }
        else{
            var str = '\n' + result['users'][0]['display_name'] + "의 방송입니다";
            str += '\nhttps://twitch.tv/' + tmpArr[1];
            console.log(str);
            var secondOptions = {
                url: 'https://api.twitch.tv/kraken/channels/' + result['users'][0]['_id'],
                headers: {
                  'Accept': 'application/vnd.twitchtv.v5+json',
                  'Client-ID' : process.env.TWITCH_TOKEN
                }
            };
            var thirdOptions = {
                url: 'https://api.twitch.tv/kraken/streams/' + result['users'][0]['_id'],
                headers: {
                  'Accept': 'application/vnd.twitchtv.v5+json',
                  'Client-ID' :process.env.TWITCH_TOKEN
                }
            };
            var tasks =[
              function(callback){
                request(secondOptions, (err, res ,body) => {
                  if (err) { return console.log(err); }
                  var channelResult = JSON.parse(body);
                  str += '\n' + channelResult['followers'] + "명의 팔로워가 있습니다.";
                  console.log(str);
                  callback();
                })
              },
              function(callback){
                request(thirdOptions, (err, res ,body) => {
                  if (err) { return console.log(err); }
                  var streamResult = JSON.parse(body);
                  if(streamResult['stream'] == null){
                      str += '\n현재 방송을 하지 않고 있습니다.';
                  }
                  else{
                      str += '\n현재 방송중입니다. 시청자수는 ' + streamResult['stream']['viewers'] + '명입니다.';
                      str += '\n방송 제목은 ' + streamResult['stream']['channel']['status'] + '입니다.';
                      str += '\n현재 진행중인 카테고리는 ' + streamResult['stream']['game'] + '입니다';
                  }
                  console.log(str);
                  callback();
                })
              }
            ];
            async.series(tasks, function(err , result){
              console.log('finish');
              msg.reply(str);
            });
        }
      });
  }
});


client.login(process.env.BOT_TOKEN);
var port = process.env.PORT || 5000;
app.listen(port, function() {
    console.log("Listening on " + port);
});