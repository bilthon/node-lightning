import { ILogger } from "@node-lightning/logger";
import { expect } from "chai";
import { Channel } from "../../../lib/channels/Channel";
import { IChannelLogic } from "../../../lib/channels/IChannelLogic";
import { FailingState } from "../../../lib/channels/states/FailingState";
import { AwaitingFundingDepthState } from "../../../lib/channels/states/opening/AwaitingFundingDepthState";
import { AwaitingFundingSignedState } from "../../../lib/channels/states/opening/AwaitingFundingSignedState";
import { OpeningError } from "../../../lib/channels/states/opening/OpeningError";
import { OpeningErrorType } from "../../../lib/channels/states/opening/OpeningErrorType";
import { FundingSignedMessage } from "../../../lib/messages/FundingSignedMessage";
import { Result } from "../../../lib/Result";
import {
    createFakeLogger,
    createFakeChannelLogicFacade,
    createFakeChannel,
    createFakeAcceptChannel,
    createFakeFundingSignedMessage,
    createFakeFundingTx,
} from "../../_test-utils";

describe(AwaitingFundingSignedState.name, () => {
    describe(AwaitingFundingSignedState.prototype.onFundingSignedMessage.name, () => {
        let logger: ILogger;
        let logic: sinon.SinonStubbedInstance<IChannelLogic>;
        let sut: AwaitingFundingSignedState;
        let channel: Channel;

        beforeEach(() => {
            logger = createFakeLogger();
            logic = createFakeChannelLogicFacade();
            sut = new AwaitingFundingSignedState(logger, logic);
            channel = createFakeChannel().attachAcceptChannel(createFakeAcceptChannel());
        });

        describe("invalid message", () => {
            beforeEach(() => {
                logic.validateFundingSignedMessage.resolves(
                    OpeningError.toResult(OpeningErrorType.InvalidCommitmentSig),
                );
            });

            it("returns failed state on validation error", async () => {
                // arrange
                const msg = createFakeFundingSignedMessage();

                // act
                const result = await sut.onFundingSignedMessage(channel, msg);

                // assert
                expect(result).to.equal(FailingState.name);
            });
        });
        describe("valid message", () => {
            let msg: FundingSignedMessage;

            beforeEach(() => {
                msg = createFakeFundingSignedMessage();
                channel.attachFundingTx(createFakeFundingTx());
                logic.validateFundingSignedMessage.resolves(Result.ok(true));
            });

            it("attaches signature to channel", async () => {
                // arrange
                expect(channel.ourSide.nextCommitmentSig).to.equal(undefined);

                // act
                await sut.onFundingSignedMessage(channel, msg);

                // assert
                expect(channel.ourSide.nextCommitmentSig).to.not.equal(undefined);
            });

            it("broadcasts the funding transaction", async () => {
                // act
                await sut.onFundingSignedMessage(channel, msg);

                // assert
                expect(logic.broadcastTx.called).to.equal(true, "broadcasts funding tx");
            });

            it("transitions to awaiting_funding_depth state", async () => {
                // act
                const result = await sut.onFundingSignedMessage(channel, msg);

                // assert
                expect(result).to.equal(AwaitingFundingDepthState.name);
            });
        });
    });
});