// The control arm: no store, so every write is refused at open and every read is a miss.
export const none = () => ({
  name: "none",
  open: async () => { throw Object.assign(new Error("the none arm keeps nothing"), { name: "NoStore" }); },
  write: async () => {},
  read: async () => false,
  drop: async () => {},
  evict: async () => {},
  list: async () => [],
  close: async () => {},
});
export default none;
