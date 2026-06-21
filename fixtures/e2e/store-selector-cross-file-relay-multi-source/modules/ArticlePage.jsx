import { Shell } from './Shell.jsx';
import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const ArticlePage = () => {
	const hero = useStoreSelector((state) => state.article.hero);
	return <Shell hero={ hero } />;
};

module.exports = { ArticlePage };
