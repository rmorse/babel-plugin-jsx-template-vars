import { Header } from './Header.jsx';
import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const ArticlePage = () => {
	const hero = useStoreSelector((state) => state.article.hero);
	return (
		<main>
			<Header hero={ hero } />
		</main>
	);
};

module.exports = { ArticlePage };
