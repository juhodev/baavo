import fetch from 'node-fetch';
import { DMChannel, MessageEmbed, NewsChannel, TextChannel, User } from 'discord.js';
import { DBCommandLog } from '../db/types';
import { knex } from '../db/utils';
import { Command } from './types';

const TopMemeCommand: Command = {
	execute: (channel, author, args, db) => {
		sendMemes(channel);
	},
	alias: ['!topmeme'],
};

async function sendMemes(channel: TextChannel | DMChannel | NewsChannel) {
	const response = await fetch('https://www.reddit.com/r/memes/top/.json?t=day');
	const json = await response.json();
	const children = json.data.children;

	const post = children[0];
	const data = post.data;

	const embed = new MessageEmbed({
		title: data.title,
	});

	if (data.post_hint === 'image') {
		embed.setImage(data.url);
	}

	const link: string = `https://www.reddit.com${data.permalink}`;

	embed.addFields(
		{
			name: 'Score',
			value: data.score,
			inline: true,
		},
		{ name: 'OP', value: data.author, inline: true },
		{ name: 'Link', value: `[Open](${link})`, inline: true },
	);

	channel.send(embed);
}
export default TopMemeCommand;
