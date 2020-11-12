import {
	CsgoMatch,
	CsgoProfile,
	CsgoUser,
	GameWithStats,
	SteamUser,
} from '../../../steam/types';
import { UserData } from '../../types';

export type SteamRouteResponse = {
	error: boolean;
	errorCode?: number;
	userData?: UserData;
	csgoProfile?: CsgoProfile;
};

export type SteamSearchResponse = {
	error: boolean;
	errorCode?: number;
	searchResult?: CsgoUser[];
};

export type SteamMatchResponse = {
	error: boolean;
	userData?: UserData;
	errorCode?: number;
	csgoMatch: CsgoMatch;
};

export type SteamUploadCodeResponse = {
	error: boolean;
	userData?: UserData;
	errorCode?: number;
	uploadCode?: string;
};

export type SteamGamesResponse = {
	error: boolean;
	errorCode?: number;
	games: GameWithStats[];
};

export type SteamUserResponse = {
	error: boolean;
	errorCode?: number;
	user?: SteamUser;
};
