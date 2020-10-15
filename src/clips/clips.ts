import * as path from 'path';
import * as fs from 'fs';
import { DB_DATA_DIR } from '../database/types';
import {
	RenderClip,
	RenderExit,
	CLIPS_DIR,
	DOWNLOADED_DIR,
	ValidRenderClip,
	VideoDownloadResult,
	MAX_NUMBER_OF_VIDEOS_DOWNLOADED,
	Clip,
} from './types';
import DB from '../database/db';
import * as youtubedl from 'youtube-dl';
import {
	DMChannel,
	Message,
	MessageEmbed,
	NewsChannel,
	TextChannel,
} from 'discord.js';
import RandomString from '../randomString';
import * as ffmpeg from 'fluent-ffmpeg';

class Clips {
	private db: DB;
	private random: RandomString;

	constructor(db: DB) {
		this.db = db;
		this.random = new RandomString();
	}

	setup() {
		const downloadedDir: string = path.resolve(DB_DATA_DIR, DOWNLOADED_DIR);
		const clipsDir: string = path.resolve(DB_DATA_DIR, CLIPS_DIR);

		if (!fs.existsSync(downloadedDir)) {
			fs.mkdirSync(downloadedDir);
		}

		if (!fs.existsSync(clipsDir)) {
			fs.mkdirSync(clipsDir);
		}
	}

	sendRandomClip(channel: TextChannel | DMChannel | NewsChannel) {
		const clipDir: string = path.resolve(DB_DATA_DIR, CLIPS_DIR);
		if (!fs.existsSync(clipDir)) {
			channel.send('No clips found!');
			return;
		}

		const clips: string[] = fs.readdirSync(clipDir);
		if (clips.length === 0) {
			channel.send('No clips found!');
			return;
		}

		const randomClip: string = this.random.pseudoRandom(clips);
		const pathToClip: string = path.resolve(
			DB_DATA_DIR,
			CLIPS_DIR,
			randomClip,
		);

		this.db.getClipsDB().addView(randomClip);
		channel.send({
			files: [
				{
					attachment: pathToClip,
					name: randomClip,
				},
			],
		});
	}

	async createClip(
		channel: TextChannel | DMChannel | NewsChannel,
		url: string,
		userStart: string,
		userEnd: string,
		userClipName: string,
	) {
		const downloadingEmbed: MessageEmbed = new MessageEmbed({
			title: 'Clips',
		}).addField('Progress', '*Downloading video...*');
		const message: Message = await channel.send(downloadingEmbed);

		this.removeOldVideosIfNeeded();
		const videoDownload: VideoDownloadResult = await this.downloadVideo(
			url,
		);

		const renderingEmbed: MessageEmbed = new MessageEmbed({
			title: 'Clips',
		}).addField(
			'Progress',
			'Downloading video... **downloaded**\n*Creating clip...*',
		);

		message.edit(renderingEmbed);

		const renderClip: RenderClip = await this.createRenderClip(
			videoDownload.filename,
			userStart,
			userEnd,
			userClipName,
		);
		const validRenderClip: ValidRenderClip = this.validateRenderClip(
			renderClip,
		);

		if (validRenderClip.error) {
			console.error(validRenderClip.message);
			return;
		}

		const renderExit: RenderExit = await this.renderPart(renderClip);

		const clip: Clip = {
			name: renderClip.clipName,
			length: renderClip.clipLength,
			originalVideoLink: url,
			path: renderClip.outputPath,
			views: 0,
		};

		this.db.getClipsDB().save(clip);

		const renderDoneEmbed: MessageEmbed = new MessageEmbed({
			title: 'Clips',
		})
			.addField(
				'Progress',
				'Downloading video... **downloaded**\nCreating clip... **created**',
			)
			.addField(
				'Clip info',
				`Clip id: **${clip.name}**\nCreating the clip took ${Math.round(
					renderExit.elapsedTime / 1000,
				)} seconds`,
			);

		message.edit(renderDoneEmbed);
	}

	private removeOldVideosIfNeeded() {
		const downloadedDir: string = path.resolve(DB_DATA_DIR, DOWNLOADED_DIR);
		const downloadedFiles: string[] = fs.readdirSync(downloadedDir);

		if (downloadedFiles.length > MAX_NUMBER_OF_VIDEOS_DOWNLOADED) {
			const randomVideo: string =
				downloadedFiles[
					Math.floor(Math.random() * downloadedFiles.length)
				];

			fs.unlinkSync(randomVideo);
		}
	}

	private downloadVideo(url: string): Promise<VideoDownloadResult> {
		return new Promise((resolve) => {
			const equalsIndex: number = url.indexOf('=');
			const youtubeId: string =
				url.substr(equalsIndex + 1, url.length) + '.mp4';
			const outputPath: string = path.resolve(
				DB_DATA_DIR,
				DOWNLOADED_DIR,
				youtubeId,
			);

			if (fs.existsSync(outputPath)) {
				resolve({
					filename: youtubeId,
					path: outputPath,
				});
				return;
			}

			const video = youtubedl(url, ['--format=22'], { cwd: __dirname });
			video.on('info', () => {
				console.log(`Download started ${url}`);
			});

			video.pipe(fs.createWriteStream(outputPath));

			video.on('end', () => {
				const result: VideoDownloadResult = {
					path: outputPath,
					filename: youtubeId,
				};
				console.log(
					`Video download completed ${JSON.stringify(result)}`,
				);
				resolve(result);
			});
		});
	}

	private validateRenderClip(renderClip: RenderClip): ValidRenderClip {
		const { inputPath, outputPath, startAt, clipLength } = renderClip;

		if (!fs.existsSync(inputPath)) {
			return {
				error: true,
				message: `Clip not found! ${inputPath}`,
			};
		}

		if (outputPath === undefined) {
			return {
				error: true,
				message: 'Output path is undefined',
			};
		}

		if (startAt === undefined) {
			return {
				error: true,
				message: 'startAt is undefined',
			};
		}

		if (clipLength === undefined || clipLength === 0) {
			return {
				error: true,
				message: `endAt is undefined or zero (${clipLength})`,
			};
		}

		return {
			error: false,
		};
	}

	private async createRenderClip(
		downloadedFile: string,
		userDefinedStart: string,
		userDefinedEnd?: string,
		userDefinedName?: string,
	): Promise<RenderClip> {
		const downloadedFilePath: string = path.resolve(
			DB_DATA_DIR,
			DOWNLOADED_DIR,
			downloadedFile,
		);

		let clipName: string;
		if (userDefinedName !== undefined) {
			clipName = userDefinedName;
		} else {
			clipName = this.db.getRRSG().generate();
		}

		const outputFileName = path.resolve(
			DB_DATA_DIR,
			CLIPS_DIR,
			clipName + '.mp4',
		);

		const timeSplitIndex: number = userDefinedStart.indexOf(':');
		// TODO: return error
		if (timeSplitIndex === -1) {
			return {
				error: true,
				message: `Your start time doesn't have a ":" in it. Use m:s format`,
			};
		}

		const startMinutesString: string = userDefinedStart.substr(
			0,
			timeSplitIndex,
		);

		const startSecondsString: string = userDefinedStart.substr(
			timeSplitIndex + 1,
			userDefinedStart.length,
		);

		if (
			Number.isNaN(startMinutesString) ||
			Number.isNaN(startSecondsString)
		) {
			return {
				error: true,
				message: `Couldn't parse the start time (one of these isn't a number) minutes: ${startMinutesString} - seconds: ${startSecondsString}`,
			};
		}

		const startMinutes: number = parseInt(startMinutesString);
		const startSeconds: number = parseInt(startSecondsString);
		const startTime: number = startMinutes * 60 + startSeconds;

		if (Number.isNaN(userDefinedEnd)) {
			return {
				error: true,
				message: `The end time isn't a number - end time: ${userDefinedEnd}`,
			};
		}

		const clipLength: number = parseInt(userDefinedEnd);

		return {
			clipName,
			clipLength,
			inputPath: downloadedFilePath,
			outputPath: outputFileName,
			startAt: startTime,
			error: false,
		};
	}

	private async renderPart(renderClip: RenderClip): Promise<RenderExit> {
		return new Promise((resolve) => {
			const { inputPath, outputPath, startAt, clipLength } = renderClip;
			console.log(inputPath, outputPath, startAt, clipLength);

			const startTime: number = new Date().getTime();
			ffmpeg(inputPath)
				.size('720x?')
				.autopad(true, '#000000')
				.setStartTime(startAt)
				.setDuration(clipLength)
				.output(outputPath)
				.on('end', () => {
					const endTime: number = new Date().getTime();

					resolve({
						elapsedTime: endTime - startTime,
					});
					return;
				})
				.run();
		});
	}
}

export default Clips;
