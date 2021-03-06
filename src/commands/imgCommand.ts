import { DMChannel, MessageEmbed, NewsChannel, TextChannel } from 'discord.js';
import DB from '../database/db';
import { Image } from '../database/types';
import { Command } from './types';

const ImgCommand: Command = {
	execute: (channel, author, args, db) => {
		if (args.length === 0) {
			sendRandomImage(channel, db);
			return;
		}

		const action = args.shift().toUpperCase();

		switch (action) {
			case 'ADD':
				db.getImgDB().addImage(channel, author, args);
				break;

			case 'LIST':
				sendImageNames(channel, db);
				break;

			case 'VIEW':
				sendImage(channel, args, db);
				break;

			case 'REMOVE':
				removeImage(channel, args, db);
				break;

			default:
				channel.send(`Action ${action} not found`);
				break;
		}
	},
	alias: ['!img'],
};

async function sendRandomImage(
	channel: TextChannel | DMChannel | NewsChannel,
	db: DB,
) {
	const randomImage: Image = await db.getImgDB().getRandomImage();
	channel.send({
		files: [
			{
				attachment: randomImage.path,
				name: randomImage.name,
			},
		],
	});
}

function removeImage(
	channel: TextChannel | DMChannel | NewsChannel,
	args: string[],
	db: DB,
) {
	const imageName: string = args.shift();

	if (imageName === undefined) {
		channel.send('!img remove <img>');
		return;
	}

	db.getImgDB().removeImage(channel, imageName);
}

async function sendImage(
	channel: TextChannel | DMChannel | NewsChannel,
	args: string[],
	db: DB,
) {
	const imageName: string = args.shift();

	if (imageName === undefined) {
		channel.send('!img view <name>');
		return;
	}

	if (!(await db.getImgDB().hasImage(imageName))) {
		channel.send(`Image with the name "${imageName}" not found`);
		return;
	}

	const image: Image = await db.getImgDB().getImage(imageName);
	channel.send({
		files: [
			{
				attachment: image.path,
				name: image.name,
			},
		],
	});
}

function sendImageNames(
	channel: TextChannel | DMChannel | NewsChannel,
	db: DB,
) {
	const images = db.getImgDB().getImages();
	let message: string = '';

	for (const img of images) {
		message += img;
		message += '\n';
	}

	const embed = new MessageEmbed({
		title: 'Images',
	}).addField('List of images', message);

	channel.send(embed);
}

export default ImgCommand;
