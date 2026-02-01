const mongoose = require("mongoose");
const { Schema } = mongoose;

const reactionSchema = new Schema(
  {
    emoji: { type: String, required: true },
    users: [
      {
        email: { type: String, required: true },
        name: { type: String, required: true },
      },
    ],
  },
  { _id: false }
);

const messageSchema = new Schema({
  collabId: {
    type: Schema.Types.ObjectId,
    ref: "Collab",
    required: true,
    index: true,
  },
  sender: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    image: { type: String, default: "./public/default-pic.png" },
  },
  content: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  reactions: [reactionSchema],
  mentions: [
    {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  ],
});

module.exports =
  mongoose.models.Message || mongoose.model("Message", messageSchema);
