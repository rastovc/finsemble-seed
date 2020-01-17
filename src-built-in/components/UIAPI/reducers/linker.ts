import { loop, Cmd } from 'redux-loop';
import {
    TOGGLE_CHANNEL_REQUEST, 
    TOGGLE_CHANNEL_SUCCESS, 
    TOGGLE_CHANNEL_FAILURE,
    LINKER_INIT,
    LINKER_INIT_SUCCESS,
    LINKER_CLEANUP,
    UPDATE_ACTIVE_CHANNELS
} from "../actionTypes";
import store from '../store';
import { toggleSuccess, toggleFailure, initSuccess, updateActiveChannels } from '../actions/linkerActions';
import { Channel, Channels, NameToId, Linker, LinkerAction } from '../types';

declare var FSBL: any;
declare var finsembleWindow: any;

const initialState: Linker = {
    channels: {},
    nameToId: {},
    isAccessibleLinker: true,
    windowIdentifier: {},
    processingRequest: false
};

// Effectful code to link/unlink the channel which will run outside the reducer function
function linkChannel(channelName: string, isActive: boolean, windowIdentifier: object) {
    return new Promise((res, rej) => {
        const callback = (err: any, data: object) => {
            if (err) return rej(err);
            res(data);
        };
        if (!isActive) {
            console.log("linking the window: ", windowIdentifier);
            FSBL.Clients.LinkerClient.linkToChannel(channelName, windowIdentifier, callback);
        } else {
            FSBL.Clients.LinkerClient.unlinkFromChannel(channelName, windowIdentifier, callback);
        }
    });
}

function initializeLinker() {
    finsembleWindow.addEventListener("blurred", () => {
        finsembleWindow.hide();
    });
    finsembleWindow.addEventListener("shown", () => {
		finsembleWindow.focus();
    });
    
    let nextChannelId: number = 0;
    const linkerInitState: Linker = Object.assign({}, initialState);
    const initialChannels: Channels = {};
    const initialNametoId: NameToId = {};

    return new Promise((res, rej) => {
        FSBL.Clients.LinkerClient.getAllChannels().forEach((channel: Channel) => {
            initialChannels[nextChannelId] = {
                id: nextChannelId,
                name: channel.name,
                color: channel.color,
                active: false
            };
            initialNametoId[channel.name] = nextChannelId;
            nextChannelId += 1;
        });
        linkerInitState.channels = initialChannels;
        linkerInitState.nameToId = initialNametoId;

        FSBL.Clients.RouterClient.addResponder("Finsemble.LinkerWindow.SetActiveChannels", function (err: any, msg: any) {
            if (err) {
                return rej(`Failed to add Finsemble.LinkerWindow.SetActiveChannels Responder: ${err}`);
            }
            const activeChannels = msg.data.channels;

            const activeChannelIds: any[number] = [];
            activeChannels.forEach((channel: Channel) => {
                activeChannelIds.push(linkerInitState.nameToId[channel.name]);
            });
            const updatedChannels: Channels = Object.assign({}, linkerInitState.channels);
            activeChannelIds.forEach((channelId: number) => {
                updatedChannels[channelId].active = true;
            });

            linkerInitState.windowIdentifier = msg.data.windowIdentifier;
            FSBL.Clients.Logger.system.log("toggle Linker window");
            msg.sendQueryResponse(null, {});
            store.dispatch(updateActiveChannels(msg.data));
            
            FSBL.Clients.ConfigClient.getValue("finsemble.accessibleLinker", (err: any, value: boolean) => {
                if (err) {
                    rej(`Error getting accessibleLinker value: ${err}`);
                }
                const newLinkerState = {
                    ...linkerInitState,
                    channels: updatedChannels,
                    isAccessibleLinker: value,
                };
                res(newLinkerState);
            });
        });
    });
}

function cleanUpAfterComponentUnmount() {
    finsembleWindow.removeEventListener("blurred", () => {
        finsembleWindow.hide();
    });
    finsembleWindow.removeEventListener("shown", () => {
		finsembleWindow.focus();
	});
}

// The linker's reducer
const linker = (state = initialState, action: LinkerAction) => {
    const { type, payload } = action;
    switch (type) {
        case LINKER_INIT:            
            return loop(state, Cmd.run(initializeLinker, {
                successActionCreator: initSuccess,
            }));
        case LINKER_INIT_SUCCESS:
            const newState = payload.value;
            return loop(newState, Cmd.run(() => FSBL.Clients.WindowClient.fitToDOM()));
        case TOGGLE_CHANNEL_REQUEST:
            const newState_request: Linker = {
                ...state,
                processingRequest: true
            };

            const cmd = Cmd.run(linkChannel, {
                successActionCreator: () => toggleSuccess(payload.channelID),
                failActionCreator: () => toggleFailure(),
                args: [newState_request.channels[payload.channelID].name, newState_request.channels[payload.channelID].active, newState_request.windowIdentifier]
            });

            return loop(newState_request, cmd);
        case TOGGLE_CHANNEL_SUCCESS:
            const newState_success = {
                ...state,
                processingRequest: false,
                channels: {
                    ...state.channels,
                    [payload.channelID]: {
                        ...state.channels[payload.channelID],
                        active: !state.channels[payload.channelID].active
                    }
                }
            };
            return newState_success;
        case TOGGLE_CHANNEL_FAILURE:
            const newState_failure = {
                ...state,
                processingRequest: false
            };
            return newState_failure;
        case UPDATE_ACTIVE_CHANNELS:
            const { updatedActiveChannels, updatedWindowIdentifier } = payload;
            const activeChannelNames: any[string] = [];
            updatedActiveChannels.forEach((channel: Channel) => {
                activeChannelNames.push(channel.name);
            });
            const updatedChannel = Object.assign({}, state.channels);
            const channelIds: any[number] = Object.keys(updatedChannel);
            channelIds.forEach((channelId: number) => {
                if (activeChannelNames.includes(updatedChannel[channelId].name)) {
                    updatedChannel[channelId].active = true;
                } else {
                    updatedChannel[channelId].active = false;
                }
            });
            const newUpdateChannelState = {
                ...state,
                channels: updatedChannel,
                windowIdentifier: updatedWindowIdentifier
            };
            return newUpdateChannelState;
        case LINKER_CLEANUP:
            return loop(state, Cmd.run(cleanUpAfterComponentUnmount));
        default:
            return state;
    }
}

export default linker;