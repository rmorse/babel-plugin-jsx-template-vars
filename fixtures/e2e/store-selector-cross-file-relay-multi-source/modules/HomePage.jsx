import { Shell } from './Shell.jsx';
import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const HomePage = () => {
	const hero = useStoreSelector((state) => state.home.hero);
	return <Shell hero={ hero } />;
};

module.exports = { HomePage };
