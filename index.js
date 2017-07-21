'use strict';
const Discord = require('eris');
// const fs = require('fs');
const mongo = require('mongodb');

var config = {};
var events = [];
var timeNow = Math.floor(new Date() / 1000);

var db;
/*
let files = fs.readdirSync('./');
if (!files.includes('config.js')) {
	return console.log('[ERROR] No Config.js file found');
}
*/
config = require('./config.js');
config.adminUsers.push(config.botOwner);

var commands = [
	[
		'ping',
		'Pong!',
		{
			description: 'Replies "Pong!"',
		},
	],
	[
		'SetPrefix',
		(msg, args) => {
			if (args.length === 1) {
				let result = db.collection('guildData')
					.update({
						_id: msg.channel.guild.id,
					}, {
						$set: {
							prefix: args[0],
						},
					}, {
						upsert: true,
					});

				if (result.hasWriteError()) {
					console.log(`[ERROR] Issue setting bot prefix for guildID ${msg.channel.guild.id}: ${result.writeError.errmsg}`);
					return 'There was an error saving settings for this guild.';
				} else {
					return `Succesfully set command prefix to ${args[0]}`;
				}
			} else {
				return 'Please supply one word or character to use as the command prefix';
			}
		},
		{
			aliases: ['Prefix', 'cmdPrefix'],
			description: 'Set the command prefix',
			fullDescription: 'Sets the prefix used before commands for this bot, only on this guild.',
			usage: 'SetPrefix <prefix>',
			guildOnly: true,
			argsRequired: true,
			requirements: {
				permissions: {
					administrator: true,
				},
			},
		},
	],
	[
		'GetLink',
		config.inviteLink === undefined || config.inviteLink === '' ? 'Sorry, an invite link has not been configured by the bot owner.' : config.inviteLink,
		{
			aliases: ['Link', 'AddURL'],
			description: 'Add me to a guild',
			fullDescription: 'Return a link which you can use to add me to your own guild.',
		},
	],
	[
		'Time',
		`Epoch Time: \`${Math.floor(new Date() / 1000)}\`\nUTC Time:   \`${new Date().toUTCString()}\``,
		{
			aliases: ['GetTime', 'Epoch'],
			description: 'Get the current Unix Epoch Time',
			fullDescription: 'Return a number which represents the number of seconds since Jan 1st 1970 UTC along with the human readable form of that number.',
		},
	],
	[
		'NewEvent',
		(msg, args) => {
			if (args.length < 3 || args.indexOf('|') < 1) {
				return '[ERROR] Syntax issue please use "Help NewEvent" to learn how to use this command';
			}
			let id, time, message, timer, doc;
			let index = args[args.length - 1].indexOf('--recurring=');
			if (index !== -1) {
				timer = args[args.length - 1].split('=')[1];
			}
			for (var i = 0; i < args.length; i++) {
				if (args === '|') {
					message.trim();
					break;
				}
				message += `${args[i]} `;
			}
			time = args[args.indexOf('|') + 1];
			if (args.join(' ').toLowerCase().includes('--channel')) {
				id = msg.channel.id;
			} else {
				id = msg.author.getDMChannel();
			}

			if (time === undefined || time < 1 || message === undefined || message === '') {
				return '[ERROR] Syntax issue please use "Help NewEvent" to learn how to use this command';
			}
			if (timer !== undefined && timer < 60) {
				return 'Recurring events should not occur more than once a minute';
			} else if (timer !== undefined) {
				doc.recurring = true;
				doc.timer = timer;
			}
			doc._id = new mongo.ObjectID();
			doc.message = message;
			doc.time = time;
			doc.channels = [id];

			let result = db.collection('events')
				.save(doc);
			if (result.hasWriteError()) {
				console.log(`[ERROR] Issue creating event: ${result.writeError.errmsg}`);
				return 'There was an error creating the event.';
			} else if (result.nInserted !== 1) {
				return 'There was an error creating the event.';
			} else {
				syncEvents();
				return `Succesfully created event with ID: ${doc._id}. You have been automatically subscibed.`;
			}
		},
		{
			aliases: ['CreateEvent'],
			description: 'Create a new event',
			fullDescription: 'Create an event which will send a reminder to all subscribed users at a specified time.',
			usage: 'NewEvent <Message> | <EpochTime> [--recurring=<SecondsBetweenEvents>] [--channel]',
			argsRequired: true,
			requirements: {
				userIDs: config.adminUsers,
				roleIDs: config.adminRoles,
			},
		},
	],
	[
		'DeleteEvent',
		(msg, args) => {
			timeNow = Math.floor(new Date() / 1000);
			let result = db.collection('events')
				.remove({
					_id: new mongo.ObjectID(args[0]),
				});

			if (result.nRemoved === 0) {
				return 'The event with that ID could not be found.';
			} else if (result.hasWriteError()) {
				console.log(`[ERROR] Issue deleting eventID ${args[0]}: ${result.writeError.errmsg}`);
				return 'There was an error deleting the event.';
			} else {
				syncEvents();
				return `Succesfully deleted event with ID: ${args[0]}`;
			}
		},
		{
			aliases: ['RemoveEvent'],
			description: 'Delete an event',
			fullDescription: 'Delete an event to remove it from the database and stop all subscribers recieving updates.',
			usage: 'DeleteEvent <EventID>',
			argsRequired: true,
			requirements: {
				userIDs: config.adminUsers,
				roleIDs: config.adminRoles,
			},
		},
	],
	[
		'ViewEvents',
		(msg, args) => {
			timeNow = Math.floor(new Date() / 1000);
			let query = {
				$or: [
					{
						$and: [
							{
								recurring: true,
							},
						],
					},
				],
			};
			if (args.join(' ').toLowerCase().includes('--subscribed')) {
				query.channels = msg.author.getDMChannel();
			}
			if (args.join(' ').toLowerCase().includes('--channel')) {
				query.channels = msg.channel.id;
			}
			if (!args.join(' ').toLowerCase().includes('--old')) {
				query.$or.push({
					time: {
						$gte: timeNow,
					},
				});
			}
			if (!args.join(' ').toLowerCase().includes('--inactive')) {
				query.$or[0].$and.push({
					active: true,
				});
			}
			db.collection('events')
				.find(query)
				.toArray((err, docs) => {
					if (err) {
						bot.createMessage(msg.channel.id, `[ERROR] Unable to access database`);
						return console.log(`[ERROR] Unable to sync events with database: ${err}`);
					}
					let message = '~~~ Event List ~~~\n';
					for (var i = 0; i < docs.length; i++) {
						message += `EventID:   ${docs[i]._id}`;
						message += `Message:   ${docs[i].message}\n`;
						message += `Time:      ${new Date(docs[i].time * 1000).toUTCSting()}\n`;
						message += `Sub Count: ${docs[i].channels.length}\n`;
						if (docs[i].recurring) {
							message += `Reccuring: Every ${docs[i].timer} seconds\n`;
						}
						message += '------\n';
					}
					message += `Total Event Count: ${docs.length}`;
					bot.createMessage(msg.author.getDMChannel(), message);
				});
		},
		{
			aliases: ['ListEvents'],
			description: 'List all available events',
			fullDescription: 'Produce a list of all events which can be subscribed to.\nUsing the "--old" or "--inactive" flags causes the results to show those events also (This may produce a very large list).\nUsing the "--subscribed" flag only shows events to which you are subscribed.\nUsing the "--channel" flag displays only events the current channel is subscribed to.',
			usage: 'ViewEvents [--old] [--inactive] [--subscribed] [--channel]',
		},
	],
	[
		'Subscribe',
		(msg, args) => {
			let id;
			if (args.join(' ').toLowerCase().includes('--channel')) {
				id = msg.channel.id;
			} else {
				id = msg.author.getDMChannel();
			}
			timeNow = Math.floor(new Date() / 1000);
			let result = db.collection('events')
				.update({
					_id: new mongo.ObjectID(args[0]),
					$or: [
						{
							time: {
								$gt: timeNow,
							},
						},
						{
							$and: [
								{
									recurring: true,
								},
								{
									active: true,
								},
							],
						},
					],
				}, {
					$push: {
						channels: id,
					},
				});

			if (result.nMatched !== 1) {
				return 'The event with that ID could not be found.';
			} else if (result.hasWriteError()) {
				console.log(`[ERROR] Issue subscribing user to eventID ${args[0]}: ${result.writeError.errmsg}`);
				return 'There was an error subscribing you to the event.';
			} else {
				syncEvents();
				return `Succesfully subscribed to event with ID: ${args[0]}`;
			}
		},
		{
			aliases: ['EventAlert'],
			description: 'Subscribe to an event',
			fullDescription: 'Subscribe to recieve notifications from a specified event.',
			usage: 'Subscribe <eventID> [--channel]',
			argsRequired: true,
		},
	],
	[
		'Unsubscribe',
		(msg, args) => {
			let id;
			if (args.join(' ').toLowerCase().includes('--channel')) {
				id = msg.channel.id;
			} else {
				id = msg.author.getDMChannel();
			}
			timeNow = Math.floor(new Date() / 1000);
			let result = db.collection('events')
				.update({
					_id: new mongo.ObjectID(args[0]),
					$or: [
						{
							time: {
								$gt: timeNow,
							},
						},
						{
							$and: [
								{
									recurring: true,
								},
								{
									active: true,
								},
							],
						},
					],
				}, {
					$pull: {
						channels: id,
					},
				});

			if (result.nMatched !== 1) {
				return 'The event with that ID could not be found.';
			} else if (result.hasWriteError()) {
				console.log(`[ERROR] Issue unsubscribing user from eventID ${args[0]}: ${result.writeError.errmsg}`);
				return 'There was an error unsubscribing you from the event.';
			} else {
				syncEvents();
				return `Succesfully unsubscribed from event with ID: ${args[0]}`;
			}
		},
		{
			aliases: ['NoNotifyEvent'],
			description: 'Unsubscribe to an event',
			fullDescription: 'Unsubscribe to stop recieving notifications from a specified event.',
			usage: 'Unsubscribe <eventID> [--channel]',
			argsRequired: true,
		},
	],
];

var bot = new Discord.CommandClient(
	config.botToken, {
		// Bot Options
	}, {
		// Command Options
		description: 'A bot to remind you of events',
		owner: '@Heroj04',
		defaultCommandOptions: {
			caseInsensitive: true,
			deleteCommand: true,
			cooldownMessage: 'You\'re using this command faster than I can cool down.',
			permissionMessage: 'You don\'t have permissions for that command.',
			errorMessage: '[ERROR] Something went wrong processing that command, try again later and if errors persist contact your administrator.',
		},
	}
);

bot
	.on('error', err => {
		console.log(`[ERROR] ERIS Error: ${err}`);
	})
	.on('ready', () => {
		db.collection('guildData')
			.find({
				prefix: {
					$ne: null,
				},
			})
			.toArray((err, data) => {
				if (err) {
					console.log(`[ERROR] Failed to retrieve Guild Data from database. Prefixes not set.`);
				}
				for (var i = 0; i < data.length; i++) {
					bot.registerGuildPrefix(data[i]._id, data[i].prefix);
				}
			});
		// Check for events every second
		setInterval(checkEvents, 1000);
		console.log('[INFO] Connected and Ready');
	});

function syncEvents() {
	db.collection('events')
		.find({
			$or: [
				{
					time: {
						$gte: timeNow,
						$lt: timeNow + 30,
					},
				},
				{
					$and: [
						{
							recurring: true,
						},
						{
							active: true,
						},
					],
				},
			],
		})
		.toArray((err, docs) => {
			if (err) {
				return console.log(`[ERROR] Unable to sync events with database: ${err}`);
			}
			events = docs;
		});
}

function checkEvents() {
	timeNow = Math.floor(new Date() / 1000);
	for (let i = 0; i < events.length; i++) {
		// See if event has triggered
		let e = events[i];
		if (!e.recurring && e.time === timeNow) {
			for (let j = 0; j < e.channels.length; j++) {
				bot.createMessage(e.channels[j], e.message);
			}
		} else if (e.recurring && (timeNow - e.time) % e.timer === 0) {
			for (let j = 0; j < e.channels.length; j++) {
				bot.createMessage(e.channels[j], e.message);
			}
		}
	}
}

function initialise() {
	// Sync the events array every 10 seconds
	syncEvents();
	setInterval(syncEvents, 10000);
	console.log('[INFO] Registering commands');
	for (let i = 0; i < commands.length; i++) {
		bot.registerCommand(commands[i][0], commands[i][1], commands[i][2]);
	}
	console.log('[INFO] Connecting to Discord');
	bot.connect();
}

console.log('[INFO] Connecting to Mongodb');
mongo.MongoClient.connect(config.connectionString, (err, database) => {
	if (err) {
		console.log(err);
		console.log(`[ERROR] Mongodb connection failed. Retrying ...`);
		// Wait 3 seconds to try again
		setTimeout(
			mongo.MongoClient.connect.bind(null, config.connectionString, (err2, database2) => {
				if (err) {
					console.log(err);
					console.log(`[ERROR] Mongodb connection failed. Retrying ...`);
					// Wait 3 seconds to try again
					setTimeout(
						mongo.MongoClient.connect.bind(null, config.connectionString, (err3, database3) => {
							if (err) {
								console.log(err);
								return console.log(`[ERROR] Mongodb connection failed. Please check the connection string and restart the bot.`);
							}
							console.log('[INFO] Connected to Mongodb');
							db = database3;
							initialise();
						}),
						3000
					);
					return;
				}
				console.log('[INFO] Connected to Mongodb');
				db = database2;
				initialise();
			}),
			3000
		);
		return;
	}
	console.log('[INFO] Connected to Mongodb');
	db = database;
	initialise();
});
