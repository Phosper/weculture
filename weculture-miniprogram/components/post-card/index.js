const { api } = require('../../services/api');
Component({
  properties: { post: Object },
  methods: {
    open() { wx.navigateTo({ url: `/pages/detail/index?id=${this.data.post.id}` }); },
    async like() { try { const result = await api.post(`/posts/${this.data.post.id}/likes`, {}); this.setData({ 'post.liked': result.liked, 'post.likeCount': result.likeCount }); } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); } },
    async favorite() { try { const result = await api.post(`/posts/${this.data.post.id}/favorite`, {}); this.setData({ 'post.favorited': result.favorited }); } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); } }
  }
});
