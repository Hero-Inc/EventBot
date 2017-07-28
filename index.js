'use strict';
const Discord = require('eris');
const Mongo = require('mongodb');
const Winston = require('winston');

var config = require('./config.js');

// Setup winston logging
var log = new Winston.Logger({
	transports: [
		new Winston.transports.Console({
			handleExceptions: true,
			level: config.consoleDebugLevel === undefined ? 'info' : config.consoleDebugLevel,
		}),
		new Winston.transports.File({
			filename: '../logs/eventBot.log',
			handleExceptions: true,
			level: config.fileDebugLevel === undefined ? 'debug' : config.fileDebugLevel,
		}),
	],
	exitOnError: false,
});

var events = [];
var timeNow = Math.floor(new Date() / 1000);
var db;

// Make the owner an admin
log.debug('Adding owner to adminUsers');
config.adminUsers.push(config.botOwner);

log.debug('Creating commands array');
var commands = [
	[
		'Ping',
		'Pong!',
		{
			description: 'Replies "Pong!"',
		},
	],
	[
		'SetPrefix',
		(msg, args) => {
			if (args.length === 1) {
				db.collection('guildData')
					.update({
						_id: msg.channel.guild.id,
					}, {
						$set: {
							prefix: args[0],
						},
					}, {
						upsert: true,
					})
					.then(result => {
						if (result.writeError) {
							log.error(`Issue setting bot prefix for guildID ${msg.channel.guild.id}`, {
								ReportedError: result.writeError.errmsg,
							});
							bot.createMessage(msg.channel.id, 'There was an error saving settings for this guild.');
						} else {
							log.debug(`Succesfully set bot prefix for guildID ${msg.channel.guild.id}`);
							bot.createMessage(msg.channel.id, `Succesfully set command prefix to ${args[0]}`);
						}
					});
			} else {
				log.debug('Bad Syntax. Prefix not set');
				return 'Please supply one word or character to use as the command prefix';
			}
		},
		{
			aliases: ['Prefix', 'cmdPrefix', '~'],
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
			aliases: ['Link', 'AddURL', '&'],
			description: 'Add me to a guild',
			fullDescription: 'Return a link which you can use to add me to your own guild.',
		},
	],
	[
		'Time',
		`Epoch Time: \`${Math.floor(new Date() / 1000)}\`\nUTC Time:   \`${new Date().toUTCString()}\``,
		{
			aliases: ['GetTime', 'Epoch', '#'],
			description: 'Get the current Unix Epoch Time',
			fullDescription: 'Return a number which represents the number of seconds since Jan 1st 1970 UTC along with the human readable form of that number.',
		},
	],
	[
		'NewEvent',
		(msg, args) => {
			let id = '',
				message = '',
				time,
				timer,
				doc = {},
				newArgs = args.join(' ').split('"').length;

			if (args.length < 3 || newArgs.length !== 3) {
				return '[ERROR] Syntax issue please use "Help NewEvent" to learn how to use this command';
			}

			id = args[0].toLowerCase();
			message = newArgs[1];
			time = parseInt(newArgs[2].trim().split(' ')[0]);
			for (let i = 0; i < args.length; i++) {
				if (args[i].toLowerCase()
					.includes('--recurring')) {
					timer = parseInt(args[i].split('=')[1]);
				}
			}

			if (id === undefined || message === undefined || message === '' || isNaN(time) || (timer !== undefined && isNaN(timer))) {
				return '[ERROR] Syntax issue please use "Help NewEvent" to learn how to use this command';
			} else if (timer !== undefined && timer < 60) {
				return '[ERROR] Recurring events should not occur more than once a minute';
			}
			doc = {
				_id: id,
				message: message,
				time: time,
				hidden: newArgs[2].toLowerCase().inludes('--hidden'),
				channels: [],
			};
			if (timer !== undefined) {
				doc.timer = timer;
			}

			let run = (channelID) => {
				doc.channels.push(channelID);
				db.collection('events')
					.save(doc)
					.then(result => {
						if (result.writeError) {
							log.error(`Issue creating event: ${result.writeError.errmsg}`);
							bot.createMessage(msg.channel.id, 'There was an error creating the event.');
						} else if (result.nInserted !== 1) {
							log.error('Something went wrong creating this event', {
								result: result,
							});
							bot.createMessage(msg.channel.id, 'There was an error creating the event.');
						} else {
							syncEvents();
							log.verbose('New event successfully created', {
								eventDoc: doc,
							});
							bot.createMessage(msg.channel.id, `Succesfully created event with ID: \`${doc._id}\`. You have been automatically subscibed.`);
						}
					});
			};

			log.debug(`Checking if event(ID: ${id}) exists`);
			db.collection('events')
				.find({
					_id: id,
				}).toArray((err, docs) => {
					if (err) {
						log.error('Something went wrong searching event database', {
							ReportedError: err,
						});
						return bot.createMessage(msg.channel.id, 'There was an error creating the event.');
					}
					if (docs !== 0) {
						return bot.createMessage(msg.channel.id, 'An event with that ID already exists.');
					}
					bot.sendChannelTyping(msg.channel.id);
					if (args.join(' ')
						.toLowerCase()
						.includes('--channel')) {
						run(msg.channel.id);
					} else {
						msg.author.getDMChannel()
							.then(channel => {
								run(channel.id);
							});
					}
				});
		},
		{
			aliases: ['CreateEvent', 'MakeEvent', '+'],
			description: 'Create a new event',
			fullDescription: 'Create an event which will send a reminder to all subscribed users at a specified EpochTime.\nIncluding the "--recurring=<someNumber>" flag will make the event occur every <someNumber> of seconds from EpochTime.\nIncluding the "--channel" flag will autosubscribe the channel not the user.\nIncluding the "--hidden" flag will hide the event from non-Admins in the viewEvents command.',
			usage: 'NewEvent <UniqueID> "<Message>" <EpochTime> [--recurring=<SecondsBetweenEvents>] [--channel] [--hidden]',
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
			db.collection('events')
				.remove({
					_id: args[0].toLowerCase(),
				})
				.then(result => {
					if (result.hasWriteError()) {
						log.error(`Issue deleting eventID ${args[0]}`, {
							ReportedError: result.writeError.errmsg,
						});
						bot.createMessage(msg.channel.id, 'There was an error deleting the event.');
					} else if (result.nRemoved === 0) {
						log.error(`Event was not deleted as no event was found with ID: ${args[0]}`);
						bot.createMessage(msg.channel.id, 'The event with that ID could not be found.');
					} else {
						syncEvents();
						log.verbose(`Succesfully deleted event with ID: ${args[0]}`);
						bot.createMessage(msg.channel.id, `Succesfully deleted event with ID: \`${args[0]}\``);
					}
				});
		},
		{
			aliases: ['RemoveEvent', 'DestroyEvent', '-'],
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
						timer: {
							$ne: null,
						},
					},
					{
						time: {
							$gte: timeNow,
						},
					},
				],
			};
			// Build the query from included flags
			log.silly('Building event query');
			if (args.join(' ')
				.toLowerCase()
				.includes('--subscribed')) {
				query.channels = msg.author.getDMChannel();
			}
			if (args.join(' ')
				.toLowerCase()
				.includes('--channel')) {
				query.channels = msg.channel.id;
			}
			if (!args.join(' ')
				.toLowerCase()
				.includes('--hidden') || !(config.adminUsers.includes(msg.author.id) || config.adminRoles.some((element) => {
					if (msg.member) {
						return msg.member.roles.includes(element);
					}
					return false;
				}))) {
				query.hidden = {
					$ne: true,
				};
			}
			if (args.join(' ')
				.toLowerCase()
				.includes('--old')) {
				query.$or.push({
					time: {
						$lte: timeNow,
					},
				});
			}
			if (!args.join(' ')
				.toLowerCase()
				.includes('--inactive')) {
				query.dead = {
					$ne: true,
				};
			}
			log.debug('Event query created', {
				query: query,
			});
			// Run the query
			db.collection('events')
				.find(query)
				.toArray((err, docs) => {
					if (err) {
						bot.createMessage(msg.channel.id, `[ERROR] Unable to access database`);
						return log.error(`Unable to access database to view events`, {
							ReportedError: err,
						});
					}
					let message = '~ ~ ~ Event List ~ ~ ~\n';
					message += 'Key:\n';
					message += '⏪ = Event already occured once';
					message += 'x = Event now inactive';
					message += '# = Event is recurring';
					message += '* = Event is hidden';
					message += '------';
					for (let i = 0; i < docs.length; i++) {
						message += `EventID: \`${docs[i]._id}\`\n`;
						message += `Details: \`${docs[i].time < Math.floor(new Date() / 1000) ? '⏪' : ''}${docs[i].dead ? 'x' : ''}${docs[i].timer !== undefined ? '#' : ''}${docs[i].hidden ? '*' : 'sdf'}`;
						message += '------';
					}
					message += `Total Event Count: \`${docs.length}\``;
					log.debug(`Succesfully returned ${docs.length} events`);
					msg.author.getDMChannel()
						.then(channel => {
							channel.createMessage(message);
						});
				});
		},
		{
			aliases: ['ListEvents', 'EventList', 'ShowEvents', '='],
			description: 'List all available events',
			fullDescription: 'Produce a list of all events which can be subscribed to.\nUsing the "--old" or "--inactive" flags causes the results to show those events also (This may produce a very large list).\nUsing the "--subscribed" flag only shows events to which you are subscribed.\nUsing the "--channel" flag displays only events the current channel is subscribed to.\nUsing the "--hidden" flag and having admin rights also shows hidden events.',
			usage: 'ViewEvents [--old] [--inactive] [--subscribed] [--channel] [--hidden]',
		},
	],
	[
		'EventDetails',
		(msg, args) => {
			db.collection('events')
				.find({
					_id: args[0].toLowerCase(),
				})
				.toArray((err, docs) => {
					if (err) {
						bot.createMessage(msg.channel.id, `[ERROR] Unable to access database`);
						return log.error(`Unable to access database to view events`, {
							ReportedError: err,
						});
					}
					if (docs.length !== 1) {
						return bot.createMessage(msg.channel.id, 'The event with that ID could not be found.');
					}
					if (docs[0].hidden && !(config.adminUsers.includes(msg.author.id) || config.adminRoles.some((element) => {
						if (msg.member) {
							return msg.member.roles.includes(element);
						}
						return false;
					}))) {
						return bot.createMessage(msg.channel.id, 'Only admins can view data of hidden events.');
					}
					let message = '';
					let recurring = docs[0].timer !== undefined;
					message += `EventID:   \`${docs[0]._id}\`\n`;
					message += `Message:   \`${docs[0].message}\`\n`;
					message += `Time:      \`${new Date(docs[0].time * 1000).toUTCString()}\`\n`;
					message += `Sub Count: \`${docs[0].channels.length}\`\n`;
					if (docs[0].hidden) {
						message += `Hidden:    \`TRUE\`\n`;
					}
					if (recurring) {
						message += `Reccuring: Every \`${docs[0].timer}\` seconds\n`;
					}
					log.debug(`Succesfully returned eventData for event(ID: ${docs[0]._id})`);
					msg.author.getDMChannel()
						.then(channel => {
							channel.createMessage(message);
						});
				});
		},
		{
			aliases: ['Details', 'EventData', 'EventInfo', '!'],
			description: 'Show information about a specified event',
			argsRequired: true,
			fullDescription: 'Display the information about an event, including the message, time of event, recurrance timer and subsciber count.',
			usage: 'EventDetails <EventID>',
		},
	],
	[
		'Subscribe',
		(msg, args) => {
			let run = (id) => {
				timeNow = Math.floor(new Date() / 1000);
				db.collection('events')
					.update({
						_id: args[0].toLowerCase(),
						dead: {
							$ne: true,
						},
						$or: [
							{
								time: {
									$gt: timeNow,
								},
							},
							{
								timer: {
									$ne: null,
								},
							},
						],
					}, {
						$push: {
							channels: id,
						},
					})
					.then(result => {
						if (result.nMatched !== 1) {
							log.debug(`Could not subscibe user to event (ID: ${args[0]}). Event not found.`);
							bot.createMessage(msg.channel.id, 'The event with that ID could not be found.');
						} else if (result.writeError) {
							log.error(`Issue subscribing user to eventID ${args[0]}`, {
								ReportedError: result.writeError.errmsg,
							});
							bot.createMessage(msg.channel.id, 'There was an error subscribing you to the event.');
						} else {
							syncEvents();
							log.debug(`Subscribed user (ID: ${msg.author.id}) to event (ID: ${args[0]})`);
							bot.createMessage(msg.channel.id, `Succesfully unsubscribed from event with ID: \`${args[0]}\``);
						}
					});
			};

			if (args.join(' ')
				.toLowerCase()
				.includes('--channel')) {
				run(msg.channel.id);
			} else {
				msg.author.getDMChannel()
					.then(channel => {
						run(channel.id);
					});
			}
		},
		{
			aliases: ['EventAlert', 'AlertEvent', 'NotifyEvent', '>'],
			description: 'Subscribe to an event',
			fullDescription: 'Subscribe to recieve notifications from a specified event.\nIncluding the "--channel" flag subscibes the current channel you are in instead of your user.',
			usage: 'Subscribe <eventID> [--channel]',
			argsRequired: true,
		},
	],
	[
		'Unsubscribe',
		(msg, args) => {
			let run = (id) => {
				timeNow = Math.floor(new Date() / 1000);
				db.collection('events')
					.update({
						_id: args[0].toLowerCase(),
					}, {
						$pull: {
							channels: id,
						},
					})
					.then(result => {
						if (result.nMatched !== 1) {
							log.debug(`Could not unsubscibe user from event (ID: ${args[0]}). Event not found.`);
							bot.createMessage(msg.channel.id, 'The event with that ID could not be found.');
						} else if (result.writeError) {
							log.error(`Issue unsubscribing user from eventID ${args[0]}`, {
								ReportedError: result.writeError.errmsg,
							});
							bot.createMessage(msg.channel.id, 'There was an error unsubscribing you from the event.');
						} else {
							syncEvents();
							log.debug(`Subscribed user (ID: ${msg.author.id}) to event (ID: ${args[0]})`);
							bot.createMessage(msg.channel.id, `Succesfully unsubscribed from event with ID: \`${args[0]}\``);
						}
					});
			};

			if (args.join(' ')
				.toLowerCase()
				.includes('--channel')) {
				run(msg.channel.id);
			} else {
				msg.author.getDMChannel()
					.then(channel => {
						run(channel.id);
					});
			}
		},
		{
			aliases: ['NoNotifyEvent', 'StopEvent', '<'],
			description: 'Unsubscribe to an event',
			fullDescription: 'Unsubscribe to stop recieving notifications from a specified event.\nIncluding the "--channel" flag unsubscibes the current channel you are in instead of your user.',
			usage: 'Unsubscribe <eventID> [--channel]',
			argsRequired: true,
		},
	],
	[
		'Shutdown',
		(msg, args) => {
			bot.disconnect();
			process.kill(process.pid, 'SIGINT');
		},
		{
			aliases: ['kill', 'x-x'],
			description: 'Shutdown the bot',
			fullDescription: 'Stops the bot process.',
			requirements: {
				userIDs: [config.botOwner],
			},
		},
	],
];

log.debug('Creating bot');
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

log.debug('Creating bot event listeners');
bot
	.on('error', err => {
		log.error(`ERIS Error`, {
			ReportedError: err,
		});
	})
	.on('warn', err => {
		log.warn(`ERIS Warning`, {
			ReportedError: err,
		});
	})
	.on('messageCreate', msg => {
		if (msg.command) {
			log.verbose('Command Recieved', {
				author: `"${msg.author.username}#${msg.author.discriminator}"`,
				msg: msg.content,
			});
		}
	})
	.on('ready', () => {
		// Set the botPrefix on server that have previously used the SetPrefix command
		log.debug('Setting guild command prefixes');
		db.collection('guildData')
			.find({
				prefix: {
					$ne: null,
				},
			})
			.toArray((err, data) => {
				if (err) {
					return log.error(`Failed to retrieve Guild Data from database. Prefixes not set.`, {
						ReportedError: err,
					});
				}
				for (let i = 0; i < data.length; i++) {
					bot.registerGuildPrefix(data[i]._id, data[i].prefix);
				}
				log.debug('Prefixes set');
			});
		// Check for events every second
		setInterval(checkEvents, 1000);
		log.info('Bot ready');
	});

// Update the local array of events with upcoming events so we don't query every second
function syncEvents() {
	log.silly('Syncing events to local array');
	timeNow = Math.floor(new Date() / 1000);
	db.collection('events')
		.find({
			dead: {
				$ne: true,
			},
			$or: [
				{
					time: {
						$gte: timeNow,
						$lt: timeNow + 60,
					},
				},
				{
					timer: {
						$ne: null,
					},
				},
			],
		})
		.toArray((err, docs) => {
			if (err) {
				return log.error(`Unable to sync events with database`, {
					ReportedError: err,
				});
			}
			events = docs;
			log.silly('Events succesfully synced to local array');
		});
}

// Check to see if any events in the local array are set to activate at the current second
function checkEvents() {
	log.silly('Checking events for activation');
	timeNow = Math.floor(new Date() / 1000);
	for (let i = 0; i < events.length; i++) {
		// See if event has triggered
		let e = events[i];
		if (e.timer === undefined && e.time === timeNow) {
			log.debug('Event activated', e);
			for (let j = 0; j < e.channels.length; j++) {
				bot.createMessage(e.channels[j], e.message);
			}
		} else if (e.timer !== undefined && (timeNow - e.time) % e.timer === 0) {
			log.debug('Event activated', e);
			for (let j = 0; j < e.channels.length; j++) {
				bot.createMessage(e.channels[j], e.message);
			}
		}
	}
}

function initialise() {
	log.verbose('Initialising bot instance');
	process.on('SIGINT', () => {
		log.info('Shutting Down');
		db.close();
		process.exit();
	});
	// Sync the events array every 10 seconds
	syncEvents();
	setInterval(syncEvents, 30000);
	log.debug('Registering commands');
	for (let i = 0; i < commands.length; i++) {
		bot.registerCommand(commands[i][0], commands[i][1], commands[i][2]);
	}
	log.debug('Connecting to Discord.');
	bot.connect();
}

log.verbose('Connecting to MongoDB', {
	link: config.connectionString,
});
Mongo.MongoClient.connect(config.connectionString, (err, database) => {
	if (err) {
		log.error('MongoDB connection failed. Retrying ...', {
			ReportedError: err,
		});
		// Wait 3 seconds to try again
		setTimeout(
			Mongo.MongoClient.connect.bind(null, config.connectionString, (err2, database2) => {
				if (err) {
					log.error('MongoDB connection failed. Retrying ...', {
						ReportedError: err2,
					});
					// Wait 3 seconds to try again
					setTimeout(
						Mongo.MongoClient.connect.bind(null, config.connectionString, (err3, database3) => {
							if (err) {
								return log.error('MongoDB connection failed. Please check connectionString in config and try again.', {
									ReportedError: err3,
								});
							}
							log.verbose('Connected to Mongodb');
							db = database3;
							initialise();
						}),
						3000
					);
					return;
				}
				log.verbose('Connected to Mongodb');
				db = database2;
				initialise();
			}),
			3000
		);
		return;
	}
	log.verbose('Connected to Mongodb');
	db = database;
	initialise();
});
