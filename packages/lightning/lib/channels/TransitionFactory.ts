import { Block, OutPoint } from "@node-lightning/bitcoin";
import { ILogger } from "@node-lightning/logger";
import { AcceptChannelMessage } from "../messages/AcceptChannelMessage";
import { ChannelReadyMessage } from "../messages/ChannelReadyMessage";
import { FundingSignedMessage } from "../messages/FundingSignedMessage";
import { Channel } from "./Channel";
import { ChannelEvent } from "./ChannelEvent";
import { IChannelLogic } from "./IChannelLogic";
import { ChannelStateId } from "./StateMachineFactory";

export class TransitionFactory {
    constructor(readonly logger: ILogger, readonly logic: IChannelLogic) {}

    public createOnAcceptChannelMessageTransition() {
        return async (channel: Channel, event: ChannelEvent): Promise<ChannelStateId> => {
            const msg = event.message as AcceptChannelMessage;

            // validate the message
            const ok = await this.logic.validateAcceptChannel(channel, msg);
            if (ok.isErr) {
                this.logger.warn("accept_channel validation failed: ", ok.error.message);
                return ChannelStateId.Channel_Failing;
            }

            // attach message props from message to channel
            channel.attachAcceptChannel(msg);

            // construct funding transaction
            const fundingTx = await this.logic.createFundingTx(channel);
            this.logger.debug("funding tx", fundingTx);

            // attaching funding transaction to channel
            channel.attachFundingTx(fundingTx);

            // create the ctx
            const [ctx] = await this.logic.createRemoteCommitmentTx(channel);
            this.logger.debug("remote ctx", ctx.toTx());

            // sign the ctx
            const sig = await this.logic.signCommitmentTx(channel, ctx);
            this.logger.debug("remote ctx sig", sig.toString("hex"));

            // create funding_created message
            const fundingCreatedMessage = await this.logic.createFundingCreatedMessage(
                channel,
                sig,
            );
            this.logger.debug("sending funding_created", fundingCreatedMessage);

            // send message to the peer
            await this.logic.sendMessage(channel.peerId, fundingCreatedMessage);

            // return new state
            return ChannelStateId.Channel_Opening_AwaitingFundingSigned;
        };
    }

    public createOnFundingSignedMessageTransition() {
        return async (channel: Channel, event: ChannelEvent): Promise<ChannelStateId> => {
            const msg = event.message as FundingSignedMessage;

            // Validate the funding_signed message
            const msgOk = await this.logic.validateFundingSignedMessage(channel, msg);
            if (msgOk.isErr) {
                this.logger.warn("funding_signed validation failed: ", msgOk.error.message);
                return ChannelStateId.Channel_Failing;
            }

            // Attach funding_signed information to channel
            channel.attachFundingSigned(msg);

            // Broadcast funding transaction
            this.logger.debug("broadcasting funding tx");
            await this.logic.broadcastTx(channel.fundingTx);

            // Transition to AwaitingFundingDepth state
            return ChannelStateId.Channel_Opening_AwaitingFundingDepth;
        };
    }

    public createOnChannelReadyTransition(success: ChannelStateId) {
        // eslint-disable-next-line @typescript-eslint/require-await
        return async (channel: Channel, event: ChannelEvent): Promise<ChannelStateId> => {
            const msg = event.message as ChannelReadyMessage;
            this.logger.debug("processing channel_ready message");

            // Validate received message
            const isValid = this.logic.validateChannelReadyMessage(channel, msg);
            if (!isValid) {
                this.logger.warn("channel_ready validation failed");
                return ChannelStateId.Channel_Failing;
            }

            // Capture the second_per_commitment_point on the channel
            channel.attachChannelReady(msg);

            // Stay in the same state until the funding depth has been reached
            return success;
        };
    }

    public createOnBlockConnected() {
        return async (channel: Channel, event: ChannelEvent): Promise<ChannelStateId> => {
            const block = event.block;

            // If the funding transaction hasn't been confirmed yet we perform
            if (!channel.fundingConfirmedHeight) {
                // If the block contains our funding transaction then we mark the
                // depth and transition to the awaiting_funding_depth state
                if (containsOutPoint(block, channel.fundingOutPoint)) {
                    const confirmedHeight = Number(block.bip34Height);
                    channel.markConfirmed(confirmedHeight);
                    return ChannelStateId.Channel_Opening_AwaitingFundingDepth;
                }

                // Otherwise we keep waiting
                return ChannelStateId.Channel_Opening_AwaitingFundingDepth;
            }

            // When block height reaches ready height...
            if (block.bip34Height >= channel.readyHeight) {
                this.logger.debug("channel funding depth has been reached");
                // Construct the channel ready message and transition
                // to either the awaiting_channel_ready state if we haven't
                // received the channel ready message or we transition to
                // Normal state
                const msg = await this.logic.createChannelReadyMessage(channel);

                // Send the message to the peer
                await this.logic.sendMessage(channel.peerId, msg);

                // If we already have the `channel_ready` message we can
                // transition to the normal state
                if (channel.hasChannelReady) {
                    return ChannelStateId.Channel_Normal;
                }
                // Otherwise we transition to waiting for the `channel_ready`
                // message
                else {
                    return ChannelStateId.Channel_Opening_AwaitingChannelReady;
                }
            }

            // Otherwise we're between the confirmed height and the ready height
            // so we stay here and wait for blocks to be solved.
            return ChannelStateId.Channel_Opening_AwaitingFundingDepth;
        };
    }
}

/**
 * Checks if a block contains an outpoint
 * @param block
 * @param target
 * @returns
 */
function containsOutPoint(block: Block, target: OutPoint): boolean {
    for (const tx of block.txs) {
        for (let i = 0; i < tx.outputs.length; i++) {
            const outpoint = new OutPoint(tx.txId, i);
            if (target.eq(outpoint)) return true;
        }
    }
    return false;
}
