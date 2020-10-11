import * as Discord from 'discord.js';
import CommandHandler from './commandHandler';
import DB from './database/db';
import * as dotenv from 'dotenv';
import UserMetrics from './metrics/userMetrics';

import QuoteCommand from './commands/quoteCommand';
import SetupCommand from './commands/setupCommand';
import MetricsCommand from './commands/metricsCommand';
import BaavoCommand from './commands/baavoCommand';

dotenv.config();

const client = new Discord.Client();

const db = new DB();
db.load();

const userMetrics = new UserMetrics(db);

const commandHandler = new CommandHandler(db);
commandHandler.registerCommand(QuoteCommand);
commandHandler.registerCommand(SetupCommand);
commandHandler.registerCommand(MetricsCommand);
commandHandler.registerCommand(BaavoCommand);

client.on('ready', () => {
	console.log('Connected');

	db.updateGuild(client);
	userMetrics.start();
});

client.on('message', (message) => {
	commandHandler.handle(message);
});

client.login(process.env.DISCORD_TOKEN);
