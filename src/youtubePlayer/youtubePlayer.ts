import {
	Channel,
	DMChannel,
	Message,
	MessageEmbed,
	NewsChannel,
	StreamDispatcher,
	TextChannel,
	User,
	VoiceChannel,
	VoiceConnection,
} from 'discord.js';
import * as ytdl from 'ytdl-core-discord';
import { db } from '..';
import DB from '../database/db';
import { isNil } from '../utils';
import { QueueItem, VideoInfo, YTPlaylist } from './types';
import { DBYtMusic, DBYtPlaylist } from '../db/types';
import { knex } from '../db/utils';
import * as ytSearch from 'yt-search';

class YoutubePlayer {
	private queue: QueueItem[];
	private playing: boolean;

	private currentItem: QueueItem;
	private currentStream: any;
	private currentChannel: VoiceChannel;
	private currentConnection: VoiceConnection;
	private currentDispatcher: StreamDispatcher;
	private currentPlayStart: number;

	private leavingTimeout: NodeJS.Timeout;
	private nameUpdate: NodeJS.Timeout;

	constructor() {
		this.queue = [];
		this.playing = false;
		this.currentPlayStart = -1;
	}

	async add(link: string, author: User, channel: TextChannel | DMChannel | NewsChannel, db: DB, playNext: boolean) {
		const userVC: VoiceChannel = this.getUserVoiceChannel(author, db);
		if (isNil(userVC)) {
			channel.send('You must be in a voice channel!');
			return;
		}

		const validUrl: boolean = this.validUrl(link);
		if (!validUrl) {
			const result = await this.search(link);
			link = result.url;
		}

		const videoInfo: VideoInfo = await this.getVideoInfo(link);
		if (isNil(videoInfo)) {
			channel.send(`Couldn't get video info (${link})`);
			return;
		}

		if (!isNil(this.currentItem)) {
			const embed: MessageEmbed = new MessageEmbed({ title: `Adding ${videoInfo.name} to the queue` });
			embed.setThumbnail(videoInfo.thumbnail);

			channel.send(embed);
		}

		if (playNext) {
			this.queue.unshift({ channel: userVC, textChannel: channel, video: videoInfo });
		} else {
			this.queue.push({ channel: userVC, textChannel: channel, video: videoInfo });
		}

		this.play();
	}

	skip(channel: DMChannel | NewsChannel | TextChannel) {
		if (isNil(this.currentItem)) {
			channel.send(new MessageEmbed({ title: 'There is nothing to skip <:seriousweldon:822983336803827753>' }));
			return;
		}

		channel.send(new MessageEmbed({ title: 'Skipping' }));
		if (!isNil(this.currentDispatcher)) {
			this.currentDispatcher.end();
			this.currentDispatcher.destroy();
		}

		if (!isNil(this.nameUpdate)) {
			clearInterval(this.nameUpdate);
			this.nameUpdate = undefined;
		}

		this.playing = false;
		this.currentItem = undefined;

		if (this.queue.length === 0) {
			this.leavingTimeout = setTimeout(() => {
				this.leaveVoice();
			}, 1000 * 60 * 2);
		}

		this.play();
	}

	sendCurrentlyPlaying(channel: TextChannel | DMChannel | NewsChannel) {
		if (isNil(this.currentItem)) {
			channel.send('Nothing is currently playing');
			return;
		}

		const embed: MessageEmbed = new MessageEmbed({ title: 'Current video' });
		embed.setThumbnail(this.currentItem.video.thumbnail);
		embed.setTimestamp();

		const timePlayed: number = Math.floor((new Date().getTime() - this.currentPlayStart) / 1000);
		const timeline: string = this.createVideoTimeline(timePlayed, this.currentItem.video.playDuration);
		embed.addField(this.currentItem.video.name, timeline);
		embed.addField('Voice channel', this.currentItem.channel.name, true);
		embed.addField('URL', this.getShortLink(this.currentItem.video.url), true);

		channel.send(embed);
	}

	sendNextVideo(channel: TextChannel | DMChannel | NewsChannel) {
		const nextItem: QueueItem = this.queue[0];

		if (isNil(nextItem)) {
			channel.send('There queue is empty');
			return;
		}

		const embed: MessageEmbed = new MessageEmbed({ title: 'Next video' });
		embed.addField(nextItem.video.name, nextItem.channel.name);
		embed.setThumbnail(nextItem.video.thumbnail);

		channel.send(embed);
	}

	printQueue(channel: TextChannel | DMChannel | NewsChannel) {
		if (this.queue.length === 0) {
			channel.send(new MessageEmbed({ title: 'Queue is empty!' }));
			return;
		}

		const embed: MessageEmbed = new MessageEmbed({ title: 'Youtube player queue' });

		let positionInQueue: number = 1;
		for (const item of this.queue) {
			embed.addField(`${positionInQueue++}: ${item.video.name}`, `Voice channel: ${item.channel.name}`);
		}

		channel.send(embed);
	}

	stopPlaying() {
		if (isNil(this.currentStream)) {
			return;
		}

		this.currentChannel.leave();
		this.currentItem = undefined;
		this.currentStream = undefined;
	}

	async playPlaylist(channel: DMChannel | TextChannel | NewsChannel, playlistName: string, author: User) {
		const userVC: VoiceChannel = this.getUserVoiceChannel(author, db);
		if (isNil(userVC)) {
			channel.send('You must be in a voice channel!');
			return;
		}

		const playlistExists: boolean = await this.hasPlaylist(playlistName);
		if (!playlistExists) {
			channel.send(
				new MessageEmbed({
					title: `Playlist "${playlistName}" does not exist <:seriousweldon:822983336803827753>`,
				}),
			);
			return;
		}

		const playlist: YTPlaylist = await this.getPlaylist(playlistName);
		const queueItems: QueueItem[] = playlist.music.map((song) => {
			return { channel: userVC, textChannel: channel, video: song };
		});

		this.queue.push(...queueItems);
		channel.send(new MessageEmbed({ title: `Added ${queueItems.length} songs to the queue!` }));
		this.play();
	}

	async sendPlaylist(channel: DMChannel | TextChannel | NewsChannel, playlistName: string) {
		const playlistExists: boolean = await this.hasPlaylist(playlistName);
		if (!playlistExists) {
			channel.send(
				new MessageEmbed({
					title: `Playlist "${playlistName}" does not exist <:seriousweldon:822983336803827753>`,
				}),
			);
			return;
		}

		const playlist: YTPlaylist = await this.getPlaylist(playlistName);
		const message: MessageEmbed = new MessageEmbed({ title: playlist.name });
		for (const song of playlist.music) {
			message.addField(song.name, this.getShortLink(song.url), true);
		}

		channel.send(message);
	}

	async addMusicToPlaylist(channel: DMChannel | TextChannel | NewsChannel, playlist: string, linkOrQuery: string) {
		const playlistExists: boolean = await this.hasPlaylist(playlist);
		if (!playlistExists) {
			channel.send(
				new MessageEmbed({
					title: `Playlist "${playlist}" does not exist <:seriousweldon:822983336803827753>`,
				}),
			);
			return;
		}
		const dbPlaylist: DBYtPlaylist = await knex<DBYtPlaylist>('yt_playlist').where({ name: playlist }).first();

		const validUrl: boolean = this.validUrl(linkOrQuery);
		if (!validUrl) {
			const search = await this.search(linkOrQuery);

			linkOrQuery = search.url;
		}

		const videoInfo: VideoInfo = await this.getVideoInfo(linkOrQuery);
		await knex<DBYtMusic>('yt_music').insert({
			title: videoInfo.name,
			duration: videoInfo.playDuration,
			link: linkOrQuery,
			playlist: dbPlaylist.id,
		});

		channel.send(
			new MessageEmbed({
				title: `${videoInfo.name} added to ${playlist} <a:forsenPls:825708477749002261>`,
			}),
		);
	}

	async createPlaylist(channel: DMChannel | TextChannel | NewsChannel, author: User, name: string) {
		const playlistExists: boolean = await this.hasPlaylist(name);
		if (playlistExists) {
			channel.send(
				new MessageEmbed({
					title: `A playlist with the name "${name}" already exists <:seriousweldon:822983336803827753>`,
				}),
			);
			return;
		}

		await knex<DBYtPlaylist>('yt_playlist').insert({
			creator: author.id,
			name,
		});
		channel.send(
			new MessageEmbed({ title: `A playlist with the name "${name}" created <:happyweldon:823037161816326184>` }),
		);
	}

	async removeSongFromPlaylist(channel: DMChannel | TextChannel | NewsChannel, playlist: string, link: string) {
		const playlistExists: boolean = await this.hasPlaylist(playlist);
		if (!playlistExists) {
			channel.send(
				new MessageEmbed({
					title: `A playlist with the name "${playlist}" does not exist <:seriousweldon:822983336803827753>`,
				}),
			);
			return;
		}

		const dbPlaylist: DBYtPlaylist = await knex<DBYtPlaylist>('yt_playlist').where({ name: playlist }).first();
		let dbMusic: DBYtMusic[] = await knex<DBYtMusic>('yt_music').where({ playlist: dbPlaylist.id, link });
		if (dbMusic.length === 0) {
			const longLink: string = this.getLongLink(link);
			const longLinkMusic: DBYtMusic[] = await knex<DBYtMusic>('yt_music').where({
				playlist: dbPlaylist.id,
				link: longLink,
			});

			if (longLinkMusic.length === 0) {
				channel.send(new MessageEmbed({ title: `Playlist ${playlist} does not have ${link}` }));
				return;
			}

			dbMusic = longLinkMusic;
		}

		await knex<DBYtMusic>('yt_music').where({ id: dbMusic[0].id }).del();
		channel.send(new MessageEmbed({ title: `${dbMusic[0].title} removed from ${dbPlaylist.name}` }));
	}

	private createVideoTimeline(played: number, videoLength: number): string {
		const percentPlayed: number = played / videoLength;
		const totalStringLength: number = 50;
		const currentTimelinePoint: number = Math.floor(totalStringLength * percentPlayed);
		const timeFormat: string = this.formatSeconds(played);

		let str: string = timeFormat + ' ';
		for (let i = 0; i < totalStringLength; i++) {
			if (i === currentTimelinePoint) {
				str += 'o';
			} else {
				str += '-';
			}
		}
		str += ' ' + this.formatSeconds(videoLength);

		return str;
	}

	private getLongLink(link: string): string {
		const lastEqualsIndex: number = link.lastIndexOf('/');
		const videoId: string = link.substr(lastEqualsIndex + 1, link.length);
		return `https://www.youtube.com/watch?v=${videoId}`;
	}

	private getShortLink(link: string): string {
		const lastEqualsIndex: number = link.lastIndexOf('=');
		const videoId: string = link.substr(lastEqualsIndex + 1, link.length);
		return `https://youtu.be/${videoId}`;
	}

	private async getPlaylist(name: string): Promise<YTPlaylist> {
		const dbPlaylist: DBYtPlaylist = await knex<DBYtPlaylist>('yt_playlist').where({ name }).first();
		const dbMusic: DBYtMusic[] = await knex<DBYtMusic>('yt_music').where({ playlist: dbPlaylist.id });

		const playlist: YTPlaylist = {
			name: dbPlaylist.name,
			music: dbMusic.map((music) => {
				return {
					name: music.title,
					playDuration: music.duration,
					start: 0,
					thumbnail: music.thumbnail,
					url: music.link,
				};
			}),
		};

		return playlist;
	}

	private async hasPlaylist(name: string): Promise<boolean> {
		const dbPlaylists: DBYtPlaylist[] = await knex<DBYtPlaylist>('yt_playlist').where({ name });
		return dbPlaylists.length > 0;
	}

	private validUrl(link: string) {
		return link.includes('https://') && link.includes('?v=');
	}

	private async getVideoInfo(link: string): Promise<VideoInfo> {
		const info = await ytdl.getInfo(link);
		const videoInfo: VideoInfo = {
			name: info['videoDetails']['title'],
			thumbnail: info['videoDetails']['thumbnails'][0]['url'],
			url: link,
			start: 0,
			playDuration: parseInt(info['videoDetails']['lengthSeconds']),
		};

		return videoInfo;
	}

	private play() {
		if (this.playing) {
			return;
		}

		const item: QueueItem = this.queue.shift();
		if (isNil(item)) {
			return;
		}

		if (!isNil(this.leavingTimeout)) {
			clearTimeout(this.leavingTimeout);
			this.leavingTimeout = undefined;
		}

		const message: MessageEmbed = new MessageEmbed({
			title: `<a:icanttakethisanymore:826145698311176273> Now playing ${item.video.name} <a:icanttakethisanymore:826145698311176273>`,
		});
		message.setThumbnail(item.video.thumbnail);
		message.addField('URL', item.video.url, true);
		message.addField('Duration', this.formatSeconds(item.video.playDuration), true);
		item.textChannel.send(message);

		db.changeUsernameEvent('DJ-Baavo', item.video.name);

		this.playing = true;
		this.playYoutube(item);
	}

	private formatSeconds(number: number): string {
		const minutes: number = Math.floor(number / 60);
		const seconds: number = number - minutes * 60;
		return `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
	}

	private async playYoutube(item: QueueItem) {
		this.currentItem = item;

		if (isNil(this.currentConnection)) {
			this.currentConnection = await item.channel.join();
			this.currentChannel = item.channel;
		} else {
			if (this.currentChannel.id !== item.channel.id) {
				this.currentConnection.disconnect();
				this.currentChannel.leave();
				this.currentConnection = await item.channel.join();
				this.currentChannel = item.channel;
			}
		}

		try {
			this.currentDispatcher = this.currentConnection.play(
				await ytdl(item.video.url, { quality: 'highestaudio', highWaterMark: 1 << 25 }),
				{ type: 'opus' },
			);
		} catch (e) {
			console.error(e);
		}

		this.currentDispatcher.on('start', () => {
			this.currentPlayStart = new Date().getTime();
			this.nameUpdate = setInterval(() => {
				if (isNil(this.currentItem)) {
					clearInterval(this.nameUpdate);
					this.nameUpdate = undefined;
					return;
				}

				const timePlayed: number = Math.floor((new Date().getTime() - this.currentPlayStart) / 1000);
				db.changeUsernameEvent(
					'DJ-Baavo',
					`${this.formatSeconds(timePlayed)} - ${this.formatSeconds(this.currentItem.video.playDuration)} ${
						this.currentItem.video.name
					}`,
				);
			}, 1000);
		});

		this.currentDispatcher.on('error', console.error);

		this.currentDispatcher.on('finish', () => {
			this.currentItem = undefined;
			this.finishedPlaying();
		});
	}

	private finishedPlaying() {
		if (!isNil(this.nameUpdate)) {
			clearInterval(this.nameUpdate);
			this.nameUpdate = undefined;
		}

		if (this.queue.length === 0) {
			this.leavingTimeout = setTimeout(() => {
				this.leaveVoice();
			}, 1000 * 60 * 2);
		}

		this.playing = false;
		this.play();
	}

	private async search(q: string): Promise<ytSearch.VideoSearchResult> {
		const result = await ytSearch(q);
		return result.videos.shift();
	}

	private leaveVoice() {
		db.changeUsernameEvent('Baavo');
		if (!this.currentConnection === undefined) {
			this.currentConnection.disconnect();
		}
		this.currentChannel.leave();
		this.currentItem = undefined;
		this.currentChannel = undefined;
		this.currentStream = undefined;
		this.currentConnection = undefined;
	}

	private getUserVoiceChannel(user: User, db: DB): VoiceChannel | undefined {
		for (const [id, channel] of db.getGuild().channels.cache) {
			if (channel instanceof VoiceChannel) {
				for (const [id, member] of channel.members) {
					if (id === user.id) {
						return channel;
					}
				}
			}
		}

		return undefined;
	}
}

export default YoutubePlayer;