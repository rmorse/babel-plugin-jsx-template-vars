# Babel Template Props
A Babel transform for rendering a template friendly version of your JSX app.  Useful for generating a (currently mustache based) pre-render for achieving SSR in environements which don't support JavaScript rendering (eg PHP).

## What is a template friendly version? 
A template friendly version will replace your components props with template strings such as `{{name}}`.

For now we support [Mustache](https://mustache.github.io/) templates as they can be processed and rendered in almost any server environment.

What this means is, you can do pseudo SSR in everonments such as PHP.

## How it works

1. You have a React / Preact App, and you already have your development / production builds
2. You need to create an additional build - called a pre-render - which extracts the rendered html into a file
3. This tranform will inject template props in to your pre-render build - so that you can later process it on the server
4. You will still need to apply this transform to your other builds (with the option `disabled: true`) so that it cleans up extra props added to your other builds.,

## How to use

`npm install babel-template-props`

Then add it as a plugin to build - if using webpack it would look like this:

```js
...
```

### Define which props will be template props

All you have to do is use `templateProps` property to your components so we know which props need to be replaced with template strings.

```jsx
const Person = ( { name } ) => {
    return (
        <div>{ name }</div>
    );
};
Person.templateProps = [ 'name' ];
```

Check out a full example here.
