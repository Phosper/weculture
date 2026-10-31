const { api } = require('../../services/api');
const { topicPath } = require('../../utils/topics');
const { authorProfilePath } = require('../../utils/authors');
Component({
  properties: { post: Object, compact: { type: Boolean, value: false } },
  methods: {
    open() { wx.navigateTo({ url: `/pages/detail/index?id=${this.data.post.id}` }); },
    openAuthor() {
      const url = authorProfilePath(this.data.post && this.data.post.author);
      if (url) wx.navigateTo({ url });
    },
    openTopic() {
      const url = this.data.post && topicPath(this.data.post.tag);
      if (url) wx.navigateTo({ url });
    },
    async like() { try { const result = await api.post(`/posts/${this.data.post.id}/likes`, {}); this.setData({ 'post.liked': result.liked, 'post.likeCount': result.likeCount }); } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); } },
    async favorite() { try { const result = await api.post(`/posts/${this.data.post.id}/favorite`, {}); this.setData({ 'post.favorited': result.favorited }); } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); } }
  }
});
